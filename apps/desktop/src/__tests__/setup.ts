import { beforeEach } from "vitest";

// The window's tab list persists in web storage and is read when a store is
// created, so every test starts from an empty window.
beforeEach(() => {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    // Node-environment tests have no web storage.
  }
});
