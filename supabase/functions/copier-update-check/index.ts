import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// GitHub repository info
const GITHUB_OWNER = "UnknowingSaturn";
const GITHUB_REPO = "saturnacademy";

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

function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
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
      // No release found - return 204 No Content (Tauri standard)
      console.log('No release found, returning 204');
      return new Response(null, { 
        headers: corsHeaders, 
        status: 204 
      });
    }

    // Parse version from tag (remove 'v' prefix if present)
    const latestVersion = release.tag_name.replace(/^v/, '');
    
    // Compare versions - return 204 if no update needed
    if (compareVersions(latestVersion, currentVersion) <= 0) {
      console.log(`No update needed: current ${currentVersion} >= latest ${latestVersion}`);
      return new Response(null, { 
        headers: corsHeaders, 
        status: 204 
      });
    }

    console.log(`Update available: ${currentVersion} -> ${latestVersion}`);

    // Find the appropriate installer asset for the platform
    const installerPatterns: Record<string, RegExp[]> = {
      'windows-x86_64': [/\.msi\.zip$/, /x64-setup\.nsis\.zip$/, /\.msi$/, /_x64-setup\.exe$/],
      'windows-i686': [/x86-setup\.nsis\.zip$/, /x86_setup\.exe$/],
      'darwin-x86_64': [/\.app\.tar\.gz$/, /\.dmg$/],
      'darwin-aarch64': [/\.app\.tar\.gz$/, /\.dmg$/],
      'linux-x86_64': [/\.AppImage\.tar\.gz$/, /\.AppImage$/],
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
      return new Response(null, { 
        headers: corsHeaders, 
        status: 204 
      });
    }

    // Fetch signature content if available
    const signature = sigAsset ? await fetchSignature(sigAsset.browser_download_url) : '';

    if (!signature) {
      console.log('No signature found for installer, cannot proceed with update');
      return new Response(null, { 
        headers: corsHeaders, 
        status: 204 
      });
    }

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

    console.log(`Returning update info: v${latestVersion}`);

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