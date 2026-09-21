/*
 * ---------------------------------------------------------------------------
 * SALES AGENTS DATA SOURCE
 * ---------------------------------------------------------------------------
 * There is no sample data here. Agents, rankings, and production figures come
 * from the database; until one is connected the page shows zeros and an empty
 * directory.
 *
 * To connect it, set VITE_AGENTS_API (see .env.example). The endpoint receives
 *
 *   ?search=&segment=all|top|managers&sortBy=totalTcp|lotsSold|name&sortDir=&page=&pageSize=
 *
 * and must search, segment, sort, and paginate SERVER-SIDE, returning JSON shaped
 * like EMPTY_AGENTS.
 *
 * `topProducers` is ranked by the database and is independent of the table
 * state: the spotlight must not reshuffle when someone searches the directory.
 */
import { SOURCE, list, num, requestJson, text, withQuery } from './api'

export { SOURCE }

/** Directory tabs; `countKey` reads the matching entry in `counts`. */
export const AGENT_SEGMENTS = [
  { value: 'all', label: 'All Agents', countKey: 'all' },
  { value: 'top', label: 'Top Performers', countKey: 'top' },
  { value: 'managers', label: 'Managers & Directors', countKey: 'managers' },
]

/** Sort choices, encoded as `field:direction` for the API. */
export const AGENT_SORTS = [
  { value: 'totalTcp:desc', label: 'Highest TCP (Total Volume)' },
  { value: 'lotsSold:desc', label: 'Most Lots Sold' },
  { value: 'name:asc', label: 'Name (A–Z)' },
]

/** The zero state — also the canonical schema the API must match. */
export const EMPTY_AGENTS = {
  // Up to three, already ranked: [{ id, name, photoUrl, totalTcp, lotsClosed }]
  topProducers: [],
  rankingsUpdatedAt: '', // ISO timestamp of the last ranking refresh
  counts: { all: 0, top: 0, managers: 0 },
  // [{ id, name, email, photoUrl, isActive, lotsSold, isTeamTotal, totalTcp }]
  agents: [],
  total: 0, // agents matching the current search + segment, across every page
  page: 1,
  pageSize: 10,
}

const API_URL = import.meta.env?.VITE_AGENTS_API ?? ''

function objects(value) {
  return list(value).filter((item) => item && typeof item === 'object')
}

/**
 * Merge an API response onto the zero shape. Anything missing, null, or the
 * wrong type becomes 0 / '' / [] rather than reaching a component.
 */
export function normalizeAgents(raw, query = {}) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const counts = src.counts ?? {}

  return {
    topProducers: objects(src.topProducers)
      .slice(0, 3)
      .map((producer, index) => ({
        id: producer.id ?? `top-${index}`,
        name: text(producer.name, '—'),
        photoUrl: text(producer.photoUrl),
        totalTcp: num(producer.totalTcp),
        lotsClosed: num(producer.lotsClosed),
      })),
    rankingsUpdatedAt: text(src.rankingsUpdatedAt),
    counts: {
      all: num(counts.all),
      top: num(counts.top),
      managers: num(counts.managers),
    },
    agents: objects(src.agents).map((agent, index) => ({
      id: agent.id ?? `agent-${index}`,
      name: text(agent.name, '—'),
      email: text(agent.email),
      photoUrl: text(agent.photoUrl),
      // null = unknown, so no presence dot is drawn rather than a wrong one.
      isActive: typeof agent.isActive === 'boolean' ? agent.isActive : null,
      lotsSold: num(agent.lotsSold),
      // Managers are credited with their team's lots; flagged so the table says so.
      isTeamTotal: agent.isTeamTotal === true,
      totalTcp: num(agent.totalTcp),
    })),
    total: num(src.total),
    page: num(src.page, num(query.page, 1)) || 1,
    pageSize: num(src.pageSize, num(query.pageSize, 10)) || 10,
  }
}

/**
 * Fetch the spotlight, tab counts, and one page of agents for the given state.
 *
 * Never throws and never fabricates: when the API is unset or unreachable it
 * resolves to the zero state and reports why via `source`.
 */
export async function fetchAgents(query = {}) {
  if (!API_URL) {
    return { ...normalizeAgents(null, query), source: SOURCE.NOT_CONFIGURED }
  }

  try {
    const raw = await requestJson(withQuery(API_URL, query))
    return { ...normalizeAgents(raw, query), source: SOURCE.DATABASE }
  } catch (err) {
    console.error('[agents] falling back to an empty directory:', err)
    return { ...normalizeAgents(null, query), source: SOURCE.UNAVAILABLE }
  }
}

export default fetchAgents
