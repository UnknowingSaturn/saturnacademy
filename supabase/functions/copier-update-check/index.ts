import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ReleaseInfo {
  version: string;
  releaseDate: string;
  downloadUrl: string;
  downloadSize: string;
  releaseNotes: string[];
  minimumVersion?: string;
  forceUpdate?: boolean;
}

// Current release information
// In production, this could be stored in the database or fetched from GitHub Releases API
const CURRENT_RELEASE: ReleaseInfo = {
  version: "1.0.0",
  releaseDate: "2025-01-15",
  downloadUrl: "https://github.com/your-org/saturn-copier-desktop/releases/latest/download/SaturnTradeCopier-setup.exe",
  downloadSize: "3.5 MB",
  releaseNotes: [
    "Initial release",
    "Ultra-low latency trade copying (20-50ms)",
    "System tray operation with mini dashboard",
    "Auto-sync configuration from cloud",
    "All risk calculation modes supported"
  ],
  minimumVersion: "1.0.0",
  forceUpdate: false
};

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

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const currentVersion = url.searchParams.get('version') || '0.0.0';
    const platform = url.searchParams.get('platform') || 'windows';

    console.log(`Update check from version ${currentVersion} on ${platform}`);

    // Check if an update is available
    const updateAvailable = compareVersions(CURRENT_RELEASE.version, currentVersion) > 0;
    
    // Check if this is a forced update (below minimum version)
    const belowMinimum = CURRENT_RELEASE.minimumVersion 
      ? compareVersions(CURRENT_RELEASE.minimumVersion, currentVersion) > 0
      : false;

    const response = {
      updateAvailable,
      forceUpdate: belowMinimum || CURRENT_RELEASE.forceUpdate,
      currentVersion,
      latestVersion: CURRENT_RELEASE.version,
      releaseDate: CURRENT_RELEASE.releaseDate,
      downloadUrl: CURRENT_RELEASE.downloadUrl,
      downloadSize: CURRENT_RELEASE.downloadSize,
      releaseNotes: CURRENT_RELEASE.releaseNotes,
      checkTimestamp: new Date().toISOString()
    };

    console.log(`Update available: ${updateAvailable}, Force update: ${response.forceUpdate}`);

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
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
