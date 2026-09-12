// Polyfill for Bun 1.2 where node:v8 startupSnapshot.isBuildingSnapshot throws NotImplementedError
try {
  const v8 = require("node:v8");
  if (v8?.startupSnapshot && typeof v8.startupSnapshot.isBuildingSnapshot === "function") {
    try {
      v8.startupSnapshot.isBuildingSnapshot();
    } catch {
      v8.startupSnapshot.isBuildingSnapshot = () => false;
    }
  }
} catch {
  // Ignore
}
