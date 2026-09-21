/*
 * Announcements read from and posted to the Supabase `announcements` table:
 * id, title, content, created_by, created_at, updated_at, user_id.
 */
import { SOURCE, text } from '@/data/api'
import { searchTerm, supabase, unwrap } from '@/data/supabase'

function normalize(row) {
  return {
    id: row.id,
    title: text(row.title, 'Untitled'),
    body: text(row.content),
    author: text(row.created_by),
    createdAt: text(row.created_at),
  }
}

/**
 * Announcements matching `search` (title or content), `sort` 'newest' or
 * 'oldest'. Never throws: failures resolve empty with a `source`.
 */
export async function fetchAnnouncements({ search = '', sort = 'newest' } = {}) {
  if (!supabase) return { announcements: [], source: SOURCE.NOT_CONFIGURED }

  try {
    let query = supabase
      .from('announcements')
      .select('id, title, content, created_by, created_at')
      .order('created_at', { ascending: sort === 'oldest' })

    const term = searchTerm(search)
    if (term) query = query.or(`title.ilike.%${term}%,content.ilike.%${term}%`)

    const { data } = unwrap(await query)
    return { announcements: data.map(normalize), source: SOURCE.DATABASE }
  } catch (err) {
    console.error('[announcements] falling back to an empty list:', err)
    return { announcements: [], source: SOURCE.UNAVAILABLE }
  }
}

/** Insert one announcement for the signed-in user; throws with Supabase's message on failure. */
export async function createAnnouncement({ title, body, userId }) {
  if (!supabase) throw new Error('No database connected — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  const { error } = await supabase
    .from('announcements')
    .insert({ title: title.trim(), content: body.trim(), user_id: userId || null })
  if (error) throw new Error(error.message)
}

/**
 * Change an announcement's title and content. Throws when the write fails or no
 * row was updated (row-level security silently filters writes it refuses).
 */
export async function updateAnnouncement(id, { title, body }) {
  if (!supabase) throw new Error('No database connected.')
  const { data } = unwrap(
    await supabase
      .from('announcements')
      .update({ title: title.trim(), content: body.trim(), updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id'),
  )
  if (!data.length) throw new Error('The database did not accept the change — you may need to sign in.')
}

/** Permanently delete one announcement. */
export async function deleteAnnouncement(id) {
  if (!supabase) throw new Error('No database connected.')
  const { data } = unwrap(await supabase.from('announcements').delete().eq('id', id).select('id'))
  if (!data.length) throw new Error('The database did not delete the announcement — you may need to sign in.')
}
