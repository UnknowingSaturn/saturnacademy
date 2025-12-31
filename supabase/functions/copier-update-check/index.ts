import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// GitHub repository info
const GITHUB_OWNER = "your-org";
const GITHUB_REPO = "saturn-copier-desktop";

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
  }>;
}

interface TauriUpdateResponse {
  version: string;
  notes: string;
  pub_date: string;
  platforms: {
    [key: string]: {
      signature: string;
      url: string;
    };
  };
}

async function fetchLatestRelease(): Promise<GitHubRelease | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Saturn-Trade-Copier-Updater',
        },
      }
    );
    
    if (!response.ok) {
      console.log(`GitHub API returned ${response.status}`);
      return null;
    }
    
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch GitHub release:', error);
    return null;
  }
}

async function fetchSignature(url: string): Promise<string> {
  try {
    const response = await fetch(url);
    if (!response.ok) return '';
    return await response.text();
  } catch {
    return '';
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const currentVersion = url.searchParams.get('current_version') || url.searchParams.get('version') || '0.0.0';
    const target = url.searchParams.get('target') || 'windows-x86_64';

    console.log(`Update check from version ${currentVersion} for target ${target}`);

    // Fetch the latest release from GitHub
    const release = await fetchLatestRelease();
    
    if (!release) {
      // No release found - return empty response (no update available)
      return new Response(
        JSON.stringify({ version: currentVersion, notes: '', pub_date: new Date().toISOString(), platforms: {} }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Parse version from tag (remove 'v' prefix if present)
    const latestVersion = release.tag_name.replace(/^v/, '');
    
    // Find the appropriate installer asset for the platform
    const installerPatterns: Record<string, RegExp[]> = {
      'windows-x86_64': [/\.msi\.zip$/, /x64-setup\.nsis\.zip$/, /\.msi$/, /_x64-setup\.exe$/],
      'windows-i686': [/x86-setup\.nsis\.zip$/, /x86_setup\.exe$/],
    };

    const patterns = installerPatterns[target] || installerPatterns['windows-x86_64'];
    
    let installerAsset = null;
    let sigAsset = null;
    
    for (const pattern of patterns) {
      installerAsset = release.assets.find(a => pattern.test(a.name));
      if (installerAsset) {
        // Look for corresponding .sig file
        sigAsset = release.assets.find(a => a.name === `${installerAsset!.name}.sig`);
        break;
      }
    }

    if (!installerAsset) {
      console.log('No suitable installer asset found in release');
      return new Response(
        JSON.stringify({ version: currentVersion, notes: '', pub_date: new Date().toISOString(), platforms: {} }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Fetch signature content if available
    const signature = sigAsset ? await fetchSignature(sigAsset.browser_download_url) : '';

    // Build Tauri-compatible update response
    const updateResponse: TauriUpdateResponse = {
      version: latestVersion,
      notes: release.body || `Update to version ${latestVersion}`,
      pub_date: release.published_at,
      platforms: {
        [target]: {
          signature: signature,
          url: installerAsset.browser_download_url,
        },
      },
    };

    console.log(`Returning update info: v${latestVersion} (current: ${currentVersion})`);

    return new Response(JSON.stringify(updateResponse), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Error checking for updates:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ 
        error: 'Failed to check for updates',
        details: errorMessage 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});
