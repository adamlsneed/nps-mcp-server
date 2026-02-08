/**
 * NPS Platform Constants and Shared Types
 */

// Fixed platform GUIDs from NPS
export const PLATFORMS = {
  WINDOWS: "d07c4352-ea1a-44a2-8fe8-6f198ec1119f",
  ACTIVE_DIRECTORY: "d6a07d9c-4b2e-4430-8c5b-401724dce933",
  LINUX: "43a54a6d-1ba3-4b98-a2eb-552e03c60766",
  MSSQL: "9837b9dd-4cb0-4bd3-8a44-f1c0e3f1b0f1",
  NPS_AM: "88aaaa60-1e6c-4676-a179-0e7e2c752f00",
  CISCO: "2ac3b44b-86ff-455f-8ff1-e2e27c790c3e",
  ENTRA_ID: "319034e0-73b0-4b1e-b764-d15b39e4cfb0",
  VAULT: "4cc424cd-81f0-4a1a-9f59-d248e2f0b950",
} as const;

export const RDP_PLATFORMS: Set<string> = new Set([
  PLATFORMS.WINDOWS,
  PLATFORMS.ACTIVE_DIRECTORY,
]);

/**
 * Check if a platform ID supports RDP connections (vs SSH)
 */
export function isRdpPlatform(platformId: string): boolean {
  return RDP_PLATFORMS.has(platformId);
}

/**
 * Get human-readable platform name from GUID
 */
export function platformName(platformId: string | null | undefined): string {
  if (!platformId) return "Unknown";
  // Match on first 8 chars to handle slight GUID variations
  const prefix = platformId.substring(0, 8);
  switch (prefix) {
    case "d07c4352":
      return "Windows";
    case "d6a07d9c":
      return "Active Directory";
    case "43a54a6d":
      return "Linux/Unix";
    case "9837b9dd":
      return "MSSQL";
    case "88aaaa60":
      return "NPS-AM";
    case "2ac3b44b":
      return "Cisco";
    case "319034e0":
      return "Entra ID";
    case "4cc424cd":
      return "Vault";
    case "00000000":
      return "Unclassified";
    default:
      return `Unknown (${prefix}...)`;
  }
}

/**
 * Session status codes
 */
export const SESSION_STATUS = {
  CREATED: 0,
  RUNNING: 1,
  COMPLETED: 3,
  FAILED: 4,
} as const;

/**
 * Describe a session status code
 */
export function sessionStatusLabel(status: number): string {
  switch (status) {
    case 0:
      return "Created (provisioning)";
    case 1:
      return "Running";
    case 3:
      return "Completed";
    case 4:
      return "Failed";
    default:
      return `Status ${status}`;
  }
}
