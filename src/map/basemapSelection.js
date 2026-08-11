// Which downloaded region the map should open, and whether a different one
// would suit where the surveyor actually is. Pure, so the rule that matters —
// the map is never switched without a confirming tap — is pinned down without
// a renderer.

export function coversPosition(region, position) {
  if (!position || !region?.bounds) return false;
  const [west, south, east, north] = region.bounds;
  return (
    position.lon >= west && position.lon <= east && position.lat >= south && position.lat <= north
  );
}

export function chooseActive({ regions = [], selectedId = null, position = null } = {}) {
  const downloaded = regions.filter((region) => region.downloaded);

  // A remembered selection wins, but only while that region is still here —
  // it may have been deleted to free space since. An online region (nothing
  // downloaded, tiles fetched live) is honoured as a *choice* but appears
  // nowhere else in this function: it is never the default and never
  // suggested, because a map that needs signal must only ever be arrived at
  // by a tap.
  const remembered = regions.find(
    (region) => region.id === selectedId && (region.downloaded || region.online),
  );
  const covering = downloaded.find((region) => coversPosition(region, position));
  const active = remembered ?? covering ?? downloaded[0] ?? null;

  // Only ever an offer. Suggesting the active region, or one that isn't on
  // the device and so couldn't be shown offline anyway, would be noise.
  const suggestion = active && covering && covering.id !== active.id ? covering : null;

  return { activeId: active?.id ?? null, suggestionId: suggestion?.id ?? null };
}
