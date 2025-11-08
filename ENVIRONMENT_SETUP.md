# Running Supabase Functions with Environment Variables

## The Issue
Supabase Edge Functions need environment variables (secrets) to be available at runtime. The `.env` file in your project root is for your local development, but edge functions need their own configuration.

## Solution: Multiple Options

### Option 1: Using supabase/.env (Recommended for Local Dev)

1. **Create the secrets file**:
   ```bash
   # Already created at: supabase/.env
   ```

2. **Start Supabase normally**:
   ```bash
   npx supabase start
   ```

3. **Serve functions with env file**:
   ```bash
   npx supabase functions serve --env-file ./supabase/.env
   ```

### Option 2: Using --env-file Flag

When testing a specific function:
```bash
npx supabase functions serve data-aggregate --env-file ./supabase/.env
```

### Option 3: Set Secrets via CLI

For individual secrets:
```bash
# Set a secret
npx supabase secrets set OPENAI_API_KEY=sk-proj-your-key

# List secrets
npx supabase secrets list

# Unset a secret
npx supabase secrets unset OPENAI_API_KEY
```

### Option 4: Use Environment Variables Directly

Export before starting:
```bash
export OPENAI_API_KEY="sk-proj-your-key"
export CRAWL4AI_BASE_URL="http://localhost:11235"
npx supabase functions serve
```

## Current Setup

Your project now has:

1. **Root `.env`** - For local development tools
   - Location: `/home/toothlessos/Projects/duke_ai/.env`
   - Used by: Your scripts, local tools

2. **Supabase `.env`** - For edge functions
   - Location: `/home/toothlessos/Projects/duke_ai/supabase/.env`
   - Used by: Edge functions when running locally
   - ⚠️ **NOT committed to git** (in .gitignore)

## Testing the Function

### Step 1: Ensure Supabase is Running
```bash
npx supabase start
```

### Step 2: Apply Database Migration
```bash
npx supabase db reset
```

### Step 3: Serve Functions with Secrets
```bash
npx supabase functions serve --env-file ./supabase/.env
```

### Step 4: Test in Another Terminal
```bash
curl -X POST http://127.0.0.1:54321/functions/v1/data-aggregate \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://github.com/octocat/Hello-World",
    "ref": "master"
  }'
```

## Troubleshooting

### "Missing OPENAI_API_KEY"
**Cause**: Edge function can't access the secret

**Solutions**:
1. Make sure `supabase/.env` exists with the key
2. Restart functions with: `npx supabase functions serve --env-file ./supabase/.env`
3. Or set via CLI: `npx supabase secrets set OPENAI_API_KEY=sk-proj-...`

### Check if Secrets are Loaded
View function logs:
```bash
npx supabase functions logs data-aggregate --follow
```

The function will log: `console.log("OPENAI_API_KEY present:", !!Deno.env.get('OPENAI_API_KEY'))`

### Verify .env File
```bash
cat supabase/.env
```

Should show:
```
OPENAI_API_KEY=sk-proj-...
CRAWL4AI_BASE_URL=http://localhost:11235
```

## Production Deployment

When deploying to production:

```bash
# Set secrets in Supabase project
npx supabase secrets set OPENAI_API_KEY=sk-proj-your-production-key \
  --project-ref your-project-ref

# Deploy function
npx supabase functions deploy data-aggregate
```

Or via Supabase Dashboard:
1. Go to Project Settings → Edge Functions
2. Click "Add Secret"
3. Add `OPENAI_API_KEY`

## Quick Reference

```bash
# Start everything (ensure supabase/.env exists first!)
npx supabase start
npx supabase db reset
npx supabase functions serve --env-file ./supabase/.env

# In another terminal, test:
./test-data-aggregate.sh
```

## Summary

✅ Created `supabase/.env` with your secrets
✅ Added to `.gitignore` to prevent accidental commits  
✅ Updated test script to load environment variables
✅ Functions will now have access to OPENAI_API_KEY

**Next**: Run the commands above to test!
