/**
 * User configuration for the departure board.
 *
 * Edit this file to change the hardcoded station presets, the number of rows shown and the line colours.
 * Station IDs can be looked up with:
 *   https://transport.opendata.ch/v1/locations?type=station&query=Bellevue
 */
export const CONFIG = {
  /** Base URL of the free Swiss public transport API by Opendata.ch (no key required). */
  apiBase: "https://transport.opendata.ch/v1",

  /** Number of departures shown on the merged board. */
  rows: 5,

  /** Seconds the "Next departures" button stays disabled after a press, to respect the API's fair use. */
  cooldownSeconds: 10,

  /** Prefixes removed from destination names to keep rows short, e.g. "Zürich, Hirzenbach" -> "Hirzenbach". */
  stripPrefixes: ["Zürich, "],

  /**
   * Hardcoded station lists. The first one is used on the very first visit.
   * Each station needs the API's `id`; `name` is only used for display until the first fetch.
   */
  presets: [
    {
      name: "City",
      stations: [
        { id: "8576193", name: "Zürich, Bellevue" },
        { id: "8591105", name: "Zürich, Bürkliplatz" },
      ],
    },
    {
      name: "Hauptbahnhof",
      stations: [{ id: "8503000", name: "Zürich HB" }],
    },
    {
      name: "Stadelhofen",
      stations: [
        { id: "8503003", name: "Zürich Stadelhofen" },
        { id: "8503059", name: "Zürich Stadelhofen, Bahnhof" },
      ],
    },
  ],

  /**
   * Optional colours for line badges, keyed by the line label exactly as it is shown on the board
   * (e.g. "4", "31", "S12"). A value is either a background colour (text colour is then picked
   * automatically for contrast) or an object { bg, fg }. Lines without an entry get the amber outline style.
   */
  lineColors: {
    // "4": "#18286B",
    // "13": { bg: "#F6C442", fg: "#000000" },
  },
};
