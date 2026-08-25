export type WorkspaceViewMode = "QUICK" | "FULL";

export type WorkspaceLinkState = {
  teamId: string | null;
  opponentId: string | null;
  viewMode: WorkspaceViewMode | null;
};

function normalizedId(value: string | null) {
  const normalized = value?.trim() ?? "";
  return normalized && normalized.length <= 200 ? normalized : null;
}

export function parseWorkspaceSearch(search: string): WorkspaceLinkState {
  const params = new URLSearchParams(search);
  const view = params.get("view")?.trim().toLowerCase();
  return {
    teamId: normalizedId(params.get("team")),
    opponentId: normalizedId(params.get("opponent")),
    viewMode: view === "quick" ? "QUICK" : view === "full" ? "FULL" : null,
  };
}

export function buildWorkspaceUrl(currentUrl: string, state: Omit<WorkspaceLinkState, "viewMode"> & { viewMode: WorkspaceViewMode }) {
  const url = new URL(currentUrl);
  url.search = "";
  if (state.teamId) url.searchParams.set("team", state.teamId);
  if (state.opponentId) url.searchParams.set("opponent", state.opponentId);
  url.searchParams.set("view", state.viewMode.toLowerCase());
  url.hash = state.teamId ? "t1-brief" : "quick-start";
  return url.toString();
}
