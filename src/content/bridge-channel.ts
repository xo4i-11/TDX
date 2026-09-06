// The one string the isolated-world bridge client and its page-world counterpart must agree on to recognise each other's postMessages.
/**
 * Shared by src/adapters/richtext.ts and src/content/bridge-main.ts. They are
 * bundled into two separate MV3 worlds, but esbuild inlines this constant into
 * each bundle independently — there is no runtime coupling, and no reason for
 * two literals that can drift. If they ever did, the bridge would time out
 * forever and every description fill would silently take the fallback path.
 */

export const BRIDGE_CHANNEL = 'tdxa';
