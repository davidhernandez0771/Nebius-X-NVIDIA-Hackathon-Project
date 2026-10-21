// Where the room view's 3D tags (HubTags) live in the DOM: a layer at the top of the workshop's overlay
// section, not beside the canvas. drei's Html portals them here, so they come first in the room's Tab
// order (shelf, machine, bench, wall) and hide with the section when a branch opens.
export const hubTagLayer: { current: HTMLElement | null } = { current: null };
