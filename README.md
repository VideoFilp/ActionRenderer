# ActionRenderer

A GitHub Actions-based video rendering project that uses Remotion to fetch design data from Supabase, render videos, and upload the rendered results to Cloudflare R2 storage.

## Project Purpose

This project provides an automated video rendering solution:

1. **Fetch Data from Supabase**: Retrieves design data from the `exports` table in Supabase database based on the provided `exportId`
2. **Video Rendering**: Uses Remotion to render design data into video files (MP4/WebM)
3. **Upload to Cloud Storage**: Uploads the rendered video to Cloudflare R2 (D2 OSS)
4. **Update Status**: Updates the export record status and output URL in Supabase

## Workflow

```
Supabase (Fetch Design Data) 
  → Remotion (Render Video) 
  → Cloudflare R2 (Upload Video) 
  → Supabase (Update Status)
```

## Usage

### Local Development

```bash
# Install dependencies
pnpm install

# Run the rendering script
npx tsx scripts/github-action-renderer.ts <exportId> [output-path]
```

### GitHub Actions

1. Manually trigger the workflow in your GitHub repository
2. Enter the `exportId` parameter
3. The workflow will automatically complete the rendering and upload process

## GitHub Actions Secrets Configuration

To use GitHub Actions, you need to configure the following Secrets in your repository. Follow these steps:

### Configuration Steps

1. Go to your GitHub repository
2. Click **Settings**
3. In the left menu, find **Secrets and variables** → **Actions**
4. Click **New repository secret**
5. Add a name and value for each secret

### Required Secrets List

#### Supabase Configuration

| Secret Name | Description | How to Obtain |
|------------|-------------|---------------|
| `PUBLIC_SUPABASE_URL` | Supabase project URL | Get it from the API settings page in your Supabase project settings |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | Get it from the API settings page in your Supabase project settings (Note: This is the service role key, not the anonymous key) |

#### Remotion Configuration

| Secret Name | Description | How to Obtain |
|------------|-------------|---------------|
| `REMOTION_BUNDLE_URL` | Remotion bundle URL | The URL of your Remotion bundle (can be a CDN link or deployed bundle address) |

#### Cloudflare R2 Configuration

| Secret Name | Description | How to Obtain |
|------------|-------------|---------------|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID | View it in the right sidebar of the Cloudflare dashboard |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | R2 access key ID | Create it in Cloudflare Dashboard → R2 → Manage R2 API Tokens |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | R2 secret access key | Generated when creating the R2 API Token (shown only once, please save it securely) |
| `CLOUDFLARE_R2_BUCKET_NAME` | R2 bucket name | The name of the bucket you created in Cloudflare R2 |
| `CLOUDFLARE_R2_PUBLIC_URL` | R2 public URL | The public access URL of the R2 bucket (use custom domain if configured) |

### Detailed Configuration Guide

#### 1. Get Supabase Credentials

1. Log in to [Supabase Dashboard](https://app.supabase.com/)
2. Select your project
3. Go to **Settings** → **API**
4. Copy **Project URL** → Set as `PUBLIC_SUPABASE_URL`
5. Copy the **service_role** key (⚠️ Note: Not the `anon` key) → Set as `SUPABASE_SERVICE_ROLE_KEY`

#### 2. Get Cloudflare R2 Credentials

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Find **Account ID** in the right sidebar → Set as `CLOUDFLARE_ACCOUNT_ID`
3. Go to **R2** → **Manage R2 API Tokens**
4. Click **Create API Token**
5. Configure permissions:
   - **Permissions**: Object Read & Write
   - **TTL**: Set as needed (or leave empty for permanent)
6. After creation, copy:
   - **Access Key ID** → Set as `CLOUDFLARE_R2_ACCESS_KEY_ID`
   - **Secret Access Key** → Set as `CLOUDFLARE_R2_SECRET_ACCESS_KEY` (⚠️ Shown only once)
7. Create a bucket in R2 (if you haven't already):
   - Record the bucket name → Set as `CLOUDFLARE_R2_BUCKET_NAME`
   - Configure public access or custom domain → Set as `CLOUDFLARE_R2_PUBLIC_URL`

#### 3. Configure Remotion Bundle URL

`REMOTION_BUNDLE_URL` should be the full URL of your Remotion bundle, for example:
- `https://your-cdn.com/remotion-bundle`
- `https://your-deployment.vercel.app`

### Verify Configuration

After configuration, you can:

1. Manually trigger the workflow in GitHub Actions
2. Enter a test `exportId`
3. Check the workflow logs to confirm all environment variables are loaded correctly

If the configuration is incorrect, the workflow will display missing environment variable error messages at the start.

## Environment Variables

### Required Environment Variables

The script requires the following environment variables to run properly:

```bash
# Supabase
PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Remotion
REMOTION_BUNDLE_URL=your_remotion_bundle_url

# Cloudflare R2
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_R2_ACCESS_KEY_ID=your_access_key_id
CLOUDFLARE_R2_SECRET_ACCESS_KEY=your_secret_access_key
CLOUDFLARE_R2_BUCKET_NAME=your_bucket_name
CLOUDFLARE_R2_PUBLIC_URL=your_public_url
```

## Project Structure

```
ActionRenderer/
├── .github/
│   └── workflows/
│       └── render-video.yml    # GitHub Actions workflow configuration
├── scripts/
│   └── github-action-renderer.ts  # Main rendering script
├── package.json
└── README.md
```

## Tech Stack

- **Remotion**: Video rendering framework
- **Supabase**: Database and API
- **Cloudflare R2**: Object storage
- **TypeScript**: Development language
- **GitHub Actions**: CI/CD automation

## Important Notes

1. ⚠️ **Service Role Key Security**: `SUPABASE_SERVICE_ROLE_KEY` has full access permissions. Keep it secure and do not expose it
2. ⚠️ **R2 Key Security**: `CLOUDFLARE_R2_SECRET_ACCESS_KEY` is shown only once when created. Save it immediately
3. 📦 **Remotion Bundle**: Ensure the bundle pointed to by `REMOTION_BUNDLE_URL` is accessible
4. 🔒 **Permission Settings**: Ensure the R2 API Token has sufficient permissions (Object Read & Write)

## Troubleshooting

### Common Errors

1. **Missing Environment Variables**
   - Check if all required Secrets are configured
   - Verify that Secret names are spelled correctly

2. **Supabase Connection Failed**
   - Verify that `PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are correct
   - Confirm you're using the `service_role` key, not the `anon` key

3. **R2 Upload Failed**
   - Check if the R2 API Token has sufficient permissions
   - Verify the bucket name and public URL are correct

4. **Remotion Rendering Failed**
   - Confirm that `REMOTION_BUNDLE_URL` is accessible
   - Check if the bundle contains the correct composition

## License

See the [LICENSE](LICENSE) file for details.
