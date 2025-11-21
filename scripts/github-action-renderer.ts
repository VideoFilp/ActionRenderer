#!/usr/bin/env tsx

/**
 * GitHub Actions 视频渲染脚本（从 Supabase 获取数据并上传到 D2 OSS）
 *
 * 使用方法:
 *   tsx scripts/github-action-renderer.ts <exportId> [output-path]
 *
 * 示例:
 *   tsx scripts/github-action-renderer.ts abc123
 *   tsx scripts/github-action-renderer.ts abc123 /tmp/output.mp4
 *
 * 环境变量（必需）:
 *   PUBLIC_SUPABASE_URL - Supabase 项目 URL
 *   SUPABASE_SERVICE_ROLE_KEY - Supabase 服务角色密钥
 *   CLOUDFLARE_ACCOUNT_ID - Cloudflare 账户 ID
 *   CLOUDFLARE_R2_ACCESS_KEY_ID - R2 访问密钥 ID
 *   CLOUDFLARE_R2_SECRET_ACCESS_KEY - R2 密钥
 *   CLOUDFLARE_R2_BUCKET_NAME - R2 存储桶名称
 *   CLOUDFLARE_R2_PUBLIC_URL - R2 公共 URL
 *   REMOTION_BUNDLE_URL - Remotion bundle URL
 *
 */

import { existsSync, mkdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { createClient } from "@supabase/supabase-js";
import { IDesign } from "@designcombo/types";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { S3Client } from "@aws-sdk/client-s3";

interface RenderOptions {
  exportId: string;
  outputPath?: string;
  bundleDir?: string;
  codec?: "h264" | "vp8" | "vp9";
  fps?: number;
  width?: number;
  height?: number;
  format?: "mp4" | "webm";
}

interface EnvironmentConfig {
  supabaseUrl: string;
  supabaseServiceKey: string;
  remotionBundleUrl: string;
  cloudflareAccountId: string;
  cloudflareR2AccessKeyId: string;
  cloudflareR2SecretAccessKey: string;
  cloudflareR2BucketName: string;
  cloudflareR2PublicUrl: string;
}

/**
 * 检查并获取所有必需的环境变量
 */
function checkAndGetEnvironmentVariables(): EnvironmentConfig {
  const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const remotionBundleUrl = process.env.REMOTION_BUNDLE_URL;
  const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const cloudflareR2AccessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const cloudflareR2SecretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  const cloudflareR2BucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;
  const cloudflareR2PublicUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL;

  const missingVars: string[] = [];

  if (!supabaseUrl) missingVars.push("PUBLIC_SUPABASE_URL");
  if (!supabaseServiceKey) missingVars.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!remotionBundleUrl) missingVars.push("REMOTION_BUNDLE_URL");
  if (!cloudflareAccountId) missingVars.push("CLOUDFLARE_ACCOUNT_ID");
  if (!cloudflareR2AccessKeyId) missingVars.push("CLOUDFLARE_R2_ACCESS_KEY_ID");
  if (!cloudflareR2SecretAccessKey) missingVars.push("CLOUDFLARE_R2_SECRET_ACCESS_KEY");
  if (!cloudflareR2BucketName) missingVars.push("CLOUDFLARE_R2_BUCKET_NAME");
  if (!cloudflareR2PublicUrl) missingVars.push("CLOUDFLARE_R2_PUBLIC_URL");

  if (missingVars.length > 0) {
    console.error("\n❌ Error: Missing required environment variables:");
    missingVars.forEach((varName) => {
      console.error(`  - ${varName}`);
    });
    console.error("\nPlease set all required environment variables before running the script.");
    console.error("See --help for more information.");
    process.exit(1);
  }

  // 此时所有变量都已确认存在，使用类型断言
  return {
    supabaseUrl: supabaseUrl!,
    supabaseServiceKey: supabaseServiceKey!,
    remotionBundleUrl: remotionBundleUrl!,
    cloudflareAccountId: cloudflareAccountId!,
    cloudflareR2AccessKeyId: cloudflareR2AccessKeyId!,
    cloudflareR2SecretAccessKey: cloudflareR2SecretAccessKey!,
    cloudflareR2BucketName: cloudflareR2BucketName!,
    cloudflareR2PublicUrl: cloudflareR2PublicUrl!,
  };
}

/**
 * 从 Supabase 获取 export 的 design 数据
 */
async function fetchDesignFromSupabase(
  exportId: string,
  supabaseUrl: string,
  supabaseServiceKey: string
) {
  console.log(`\n🔍 Fetching design data for export: ${exportId}`);

  // 创建 Supabase 客户端（使用 Service Role Key 以绕过 RLS）
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  // 从 Supabase 获取 exports 表的 design 数据
  console.log(`\n🔍 Fetching export data for ID: ${exportId}...`);
  const { data: exportDataList, error } = await supabase
    .from("exports")
    .select("design, id, status, user_id")
    .eq("id", exportId)
    .limit(1);

  if (error) {
    console.error(`\n❌ Failed to fetch export data:`, error);
    throw new Error(`Failed to fetch export data: ${error.message}`);
  }

  if (!exportDataList || exportDataList.length === 0) {
    console.error(`\n❌ Error: Export record not found`);
    throw new Error(`Export ${exportId} not found`);
  }

  // 使用第一条记录
  const exportData = exportDataList[0];
  if (exportDataList.length > 1) {
    console.log(
      `⚠️  Warning: Multiple records found with the same ID, using the first one`
    );
  }

  if (!exportData || !exportData.design) {
    console.error(`\n❌ Error: Design data is missing in export record`);
    throw new Error(`Design data is missing for export ${exportId}`);
  }

  console.log(`✅ Loaded design data for export: ${exportId}`);

  // 将 design 数据作为 inputProps
  return exportData.design as IDesign;
}

async function render(
  options: RenderOptions,
  envConfig: EnvironmentConfig
) {
  const {
    exportId,
    outputPath,
    bundleDir,
    codec = "h264",
    width = 1920,
    height = 1080,
    fps = 30,
    format = "mp4",
  } = options;

  // 如果没有提供 outputPath，使用临时文件路径
  const finalOutputPath = outputPath || path.join(tmpdir(), `render-${exportId}-${Date.now()}.mp4`);

  // 使用环境变量配置（命令行参数可以覆盖）
  const supabaseUrl = envConfig.supabaseUrl;
  const supabaseServiceKey = envConfig.supabaseServiceKey;
  const remotionBundleUrl = bundleDir || envConfig.remotionBundleUrl;

  // 从 Supabase 获取 design 数据
  const designData = await fetchDesignFromSupabase(
    exportId,
    supabaseUrl,
    supabaseServiceKey
  );

  // 准备输入数据
  const inputProps = {
    design: designData,
    options: {
      fps: designData.fps || fps,
      width: designData.size.width || width,
      height: designData.size.height || height,
      format: format || "mp4",
      codec: codec || "h264",
    },
  };
  console.log("✅ Input props:", inputProps);

  // 使用 Remotion bundle URL
  const serveUrl = remotionBundleUrl;


  // 准备输出目录
  const outputDir = path.dirname(finalOutputPath);
  if (outputDir && !existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
    console.log("📁 Created output directory:", outputDir);
  }

  console.log("🚀 Starting Remotion render...");
  console.log("");
  console.log("Configuration:");
  console.log(`  Entry Point: ${serveUrl}`);
  console.log(`  Composition: RenderComposition`);
  console.log(`  Output: ${path.resolve(finalOutputPath)}`);
  console.log(`  Codec: ${codec}`);
  if (designData && typeof designData === "object" && "fps" in designData) {
    console.log(`  FPS: ${(designData as any).fps}`);
  }
  if (designData && typeof designData === "object" && "size" in designData) {
    const size = (designData as any).size;
    if (size && size.width && size.height) {
      console.log(`  Size: ${size.width}x${size.height}`);
    }
  }

  console.log("");
  console.log("Running command...");
  console.log("─".repeat(80));

  // 更新 Supabase exports 表的状态为 processing
  console.log("\n🔄 Updating export status to processing...");
  await updateExportStatusToProcessing(
    exportId,
    supabaseUrl,
    supabaseServiceKey
  );
  console.log("✅ Export status updated to processing");

  // Get the composition you want to render. Pass `inputProps` if you
  // want to customize the duration or other metadata.
  const composition = await selectComposition({
    serveUrl: serveUrl,
    id: "RenderComposition",
    inputProps: inputProps,
  });

  // Render the video. Pass the same `inputProps` again
  // if your video is parametrized with data.
  await renderMedia({
    composition,
    serveUrl: serveUrl,
    codec: codec,
    outputLocation: finalOutputPath,
    chromiumOptions: {
      enableMultiProcessOnLinux: true,
    },
    inputProps: inputProps,
  });

  console.log("✅ Rendering completed successfully");
  console.log(`✅ Rendered composition ${composition.id} to ${finalOutputPath}`);

  // 上传到 D2 OSS
  console.log("\n📤 Uploading video to D2 OSS...");
  const publicUrl = await uploadVideoToD2(finalOutputPath, exportId, envConfig);

  // 更新 Supabase exports 表
  console.log("\n💾 Updating export record in Supabase...");
  await updateExportOutputUrl(
    exportId,
    supabaseUrl,
    supabaseServiceKey,
    publicUrl
  );
  console.log(`✅ Export record updated with output URL: ${publicUrl}`);
}

/**
 * 上传视频文件到 D2 OSS (Cloudflare R2)
 */
async function uploadVideoToD2(
  filePath: string,
  exportId: string,
  envConfig: EnvironmentConfig
): Promise<string> {
  const {
    cloudflareAccountId: accountId,
    cloudflareR2AccessKeyId: accessKeyId,
    cloudflareR2SecretAccessKey: secretAccessKey,
    cloudflareR2BucketName: bucketName,
    cloudflareR2PublicUrl: publicUrl,
  } = envConfig;

  // 读取文件
  const fileBuffer = readFileSync(filePath);
  const fileName = path.basename(filePath);
  const fileExtension = path.extname(fileName) || ".mp4";

  // 生成 D2 存储路径
  const objectKey = `exports/${exportId}${fileExtension}`;

  // 创建 S3 客户端
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const s3Client = new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: true,
  });

  // 上传文件
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: objectKey,
    Body: fileBuffer,
    ContentType: "video/mp4",
  });

  await s3Client.send(command);

  // 获取公共 URL
  const cleanPath = objectKey.startsWith("/") ? objectKey.slice(1) : objectKey;
  return `${publicUrl}/${cleanPath}`;
}

/**
 * 更新 Supabase exports 表的状态为 processing
 */
async function updateExportStatusToProcessing(
  exportId: string,
  supabaseUrl: string,
  supabaseServiceKey: string
): Promise<void> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { error } = await supabase
    .from("exports")
    .update({
      status: "processing",
      progress: 0,
    })
    .eq("id", exportId);

  if (error) {
    console.error(`Failed to update export ${exportId} to processing:`, error);
    throw new Error(`Failed to update export status: ${error.message}`);
  }
}

/**
 * 更新 Supabase exports 表的 output_url
 */
async function updateExportOutputUrl(
  exportId: string,
  supabaseUrl: string,
  supabaseServiceKey: string,
  outputUrl: string
): Promise<void> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { error } = await supabase
    .from("exports")
    .update({
      output_url: outputUrl,
      status: "completed",
      progress: 100,
    })
    .eq("id", exportId);

  if (error) {
    console.error(`Failed to update export ${exportId}:`, error);
    throw new Error(`Failed to update export output URL: ${error.message}`);
  }
}

// 命令行参数解析
// 格式: tsx scripts/github-action-renderer.ts <exportId> [output-path] [options]
const args = process.argv.slice(2);

// 显示帮助信息
if (args.includes("--help") || args.includes("-h") || args.length === 0) {
  console.log(
    "Usage: tsx scripts/github-action-renderer.ts <exportId> [output-path] [options]"
  );
  console.log("");
  console.log("Required:");
  console.log("  exportId              Export record ID from Supabase");
  console.log("");
  console.log("Optional:");
  console.log(
    "  output-path           Output file path (default: temporary file in system temp directory)"
  );
  console.log("");
  console.log("Options:");
  console.log("  --codec=h264|vp8|vp9  Video codec (default: h264)");
  console.log("  --fps=30              Frame rate (default: from design data)");
  console.log(
    "  --width=1920          Video width (default: from design data)"
  );
  console.log(
    "  --height=1080         Video height (default: from design data)"
  );
  console.log(
    "  --bundle-dir=URL      Bundle directory URL (overrides REMOTION_BUNDLE_URL env var)"
  );
  console.log("");
  console.log("Required Environment Variables:");
  console.log("  PUBLIC_SUPABASE_URL - Supabase project URL");
  console.log("  SUPABASE_SERVICE_ROLE_KEY - Supabase service role key");
  console.log("  REMOTION_BUNDLE_URL - Remotion bundle URL");
  console.log("  CLOUDFLARE_ACCOUNT_ID - Cloudflare account ID");
  console.log("  CLOUDFLARE_R2_ACCESS_KEY_ID - R2 access key ID");
  console.log("  CLOUDFLARE_R2_SECRET_ACCESS_KEY - R2 secret access key");
  console.log("  CLOUDFLARE_R2_BUCKET_NAME - R2 bucket name");
  console.log("  CLOUDFLARE_R2_PUBLIC_URL - R2 public URL");
  console.log("");
  console.log("Examples:");
  console.log("  tsx scripts/github-action-renderer.ts abc123");
  console.log("  tsx scripts/github-action-renderer.ts abc123 output.mp4");
  console.log(
    "  tsx scripts/github-action-renderer.ts abc123 output.mp4 --codec=h264"
  );
  if (args.includes("--help") || args.includes("-h")) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

// 必需参数：exportId
const exportId = args[0];
if (!exportId) {
  console.error("❌ Error: exportId is required");
  console.error("Run with --help for usage information");
  process.exit(1);
}

// 可选参数（如果未提供，脚本会使用临时文件路径）
const outputPath = args[1];

// 解析选项
const options: RenderOptions = {
  exportId,
  outputPath,
};

// 解析其他选项（从第2个参数开始，因为前2个是位置参数）
for (let i = 2; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith("--codec=")) {
    options.codec = arg.split("=")[1] as "h264" | "vp8" | "vp9";
  } else if (arg.startsWith("--fps=")) {
    options.fps = parseInt(arg.split("=")[1], 10);
  } else if (arg.startsWith("--width=")) {
    options.width = parseInt(arg.split("=")[1], 10);
  } else if (arg.startsWith("--height=")) {
    options.height = parseInt(arg.split("=")[1], 10);
  } else if (arg.startsWith("--bundle-dir=")) {
    options.bundleDir = arg.split("=")[1];
  }
}

// 在执行脚本之前，统一检查所有必需的环境变量
const envConfig = checkAndGetEnvironmentVariables();

render(options, envConfig).catch((error) => {
  console.error("❌ Unexpected error:", error);
  process.exit(1);
});
