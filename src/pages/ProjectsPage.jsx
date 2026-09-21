import { useMemo, useState } from 'react'
import { Flex, Icon, Text } from '@chakra-ui/react'
import { LuDownload, LuPlus, LuTags, LuTrash2, LuUpload } from 'react-icons/lu'
import ProjectsSkeleton from '@/components/skeletons/ProjectsSkeleton'
import CategoryPricesDialog from '@/components/projects/CategoryPricesDialog'
import {
  LotDeleteDialog,
  LotDetailsDialog,
  LotEditDialog,
  LotsBulkDeleteDialog,
} from '@/components/projects/LotDialogs'
import { Reveal } from '@/components/ui-kit/Reveal'
import useDebouncedValue from '@/hooks/useDebouncedValue'
import useProjectLots from '@/hooks/useProjectLots'
import ProjectHeader from '@/components/projects/ProjectHeader'
import ProjectMapView from '@/components/projects/ProjectMapView'
import DevGalleryView from '@/components/projects/DevGalleryView'
import LotImportDialog from '@/components/projects/LotImportDialog'
import LotStatsRow from '@/components/projects/LotStatsRow'
import LotFilters from '@/components/projects/LotFilters'
import LotsTable from '@/components/projects/LotsTable'
import SourceNotice from '@/components/SourceNotice'
import { SUPABASE_ENV, uiStatus } from '@/data/supabase'
import { DEFAULT_PROJECT_CODE, DEFAULT_SORT, LOT_STATUS_OPTIONS, updateLotStatus } from '@/data/projectsData'
import { exportLotsCsv } from '@/data/lotImportData'
import { COLORS } from '@/theme/colors'

const EMPTY_FILTERS = { status: '', phase: '', category: '' }

const PROJECT_ACTIONS = [
  { value: 'update-prices', label: 'Update category prices', icon: LuTags },
  { value: 'add-lot', label: 'Add lot', icon: LuPlus },
  { value: 'import-lots', label: 'Import lots (CSV)', icon: LuUpload },
  { value: 'export-lots', label: 'Export lots', icon: LuDownload },
]

export default function ProjectsPage({ initialView = 'table', initialProjectCode = DEFAULT_PROJECT_CODE }) {
  const [view, setView] = useState(initialView)
  const [projectCode, setProjectCode] = useState(initialProjectCode)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [selectedIds, setSelectedIds] = useState(() => new Set())

  // The input updates instantly; the database is only asked once typing pauses.
  const debouncedSearch = useDebouncedValue(search.trim(), 300)

  const query = useMemo(
    () => ({
      projectCode,
      search: debouncedSearch,
      status: filters.status,
      phase: filters.phase,
      category: filters.category,
      sortBy: sort.by,
      sortDir: sort.dir,
      page,
      pageSize,
    }),
    [projectCode, debouncedSearch, filters, sort, page, pageSize],
  )

  const { data: fetched, loading, reload } = useProjectLots(query)

  /*
   * Status edits show immediately. Each edit remembers the payload it was made
   * on, so once the post-save reload lands the fresh row wins automatically.
   */
  const [statusEdits, setStatusEdits] = useState({})
  const [savingIds, setSavingIds] = useState(() => new Set())
  const [statusError, setStatusError] = useState('')
  const [pricesOpen, setPricesOpen] = useState(false)
  const [pricesNotice, setPricesNotice] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  // { type: 'details' | 'add' | 'update' | 'delete', lot } for the open lot dialog, or null (lot is null for 'add').
  const [lotDialog, setLotDialog] = useState(null)
  // True while the selected lots are waiting on a delete confirmation.
  const [bulkDelete, setBulkDelete] = useState(false)

  const data = useMemo(() => {
    if (!fetched) return fetched
    return {
      ...fetched,
      lots: fetched.lots.map((lot) => {
        const edit = statusEdits[lot.id]
        if (!edit || edit.base !== fetched) return lot
        return { ...lot, rawStatus: edit.status, status: uiStatus(edit.status) }
      }),
    }
  }, [fetched, statusEdits])

  /*
   * True once a tab has actually been switched. The first paint is already being
   * revealed by the page itself, so the panel only animates from the second view on.
   */
  const [tabSwitched, setTabSwitched] = useState(false)

  function handleViewChange(next) {
    if (next === view) return
    setTabSwitched(true)
    setView(next)
  }

  function handleStatusChange(lot, status) {
    if (status === lot.rawStatus) return
    saveStatus(lot, status)
  }

  async function saveStatus(lot, status) {
    setStatusError('')
    setStatusEdits((prev) => ({ ...prev, [lot.id]: { status, base: fetched } }))
    setSavingIds((prev) => new Set(prev).add(lot.id))
    try {
      await updateLotStatus(lot.id, status, fetched.project.code)
      reload()
    } catch (err) {
      console.error('[projects] could not update lot status:', err)
      setStatusError(`Could not change ${lot.identifier} to "${status}": ${err.message}`)
      // Put the old status back.
      setStatusEdits((prev) => {
        const next = { ...prev }
        delete next[lot.id]
        return next
      })
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev)
        next.delete(lot.id)
        return next
      })
    }
  }

  /*
   * Anything that changes which rows exist returns to page 1 and clears the
   * selection, so a selection can never quietly include rows the user can no
   * longer see.
   */
  function resetPaging() {
    setPage(1)
    setSelectedIds(new Set())
  }

  /** A different project has different phases and categories, so filters start over. */
  function handleProjectChange(code) {
    setProjectCode(code)
    setSearch('')
    setFilters(EMPTY_FILTERS)
    setStatusError('')
    resetPaging()
  }

  function handleSearchChange(value) {
    setSearch(value)
    resetPaging()
  }

  function handleFilterChange(patch) {
    setFilters((prev) => ({ ...prev, ...patch }))
    resetPaging()
  }

  function handleReset() {
    setSearch('')
    setFilters(EMPTY_FILTERS)
    setSort(DEFAULT_SORT)
    resetPaging()
  }

  function handleSort(key) {
    setSort((prev) =>
      prev.by === key ? { by: key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { by: key, dir: 'asc' },
    )
    resetPaging()
  }

  function handleSortDirToggle() {
    setSort((prev) => ({ ...prev, dir: prev.dir === 'asc' ? 'desc' : 'asc' }))
    resetPaging()
  }

  function handlePageChange(next) {
    setPage(next)
    setSelectedIds(new Set())
  }

  function handlePageSizeChange(size) {
    setPageSize(size)
    resetPaging()
  }

  function toggleRow(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function togglePage(ids) {
    setSelectedIds((prev) => {
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id))
      const next = new Set(prev)
      ids.forEach((id) => {
        if (allSelected) next.delete(id)
        else next.add(id)
      })
      return next
    })
  }

  function handleRowAction(action, lot) {
    if (action === 'copy-row') {
      copyRow(lot)
      return
    }
    if (action === 'details' || action === 'update' || action === 'delete') {
      setPricesNotice('')
      setLotDialog({ type: action, lot })
    }
  }

  /**
   * Copy one lot's columns as a header line and a value line, tab-separated, so
   * pasting into a spreadsheet fills one cell per column. Numbers stay unformatted
   * so the spreadsheet can total them.
   */
  async function copyRow(lot) {
    const cell = (value) => String(value ?? '').replace(/[\t\r\n]+/g, ' ')
    const statusLabel = LOT_STATUS_OPTIONS.find((option) => option.value === lot.rawStatus)?.label ?? lot.rawStatus
    const { terms } = data
    const columns = [
      [terms.identifier, lot.identifier],
      ...(terms.group ? [[terms.group, lot.phase]] : []),
      ['Category', lot.category],
      ...(terms.unitFields ?? []).map((field) => [field.label, lot[field.key]]),
      [`${terms.area} (sqm)`, lot.areaSqm],
      ...(terms.pricing === false
        ? []
        : [
            ['Price / sqm', lot.pricePerSqm],
            ['TCP', lot.tcp],
          ]),
      ['Status', statusLabel],
      ['Sold By', lot.soldBy],
    ]
    const tsv = [columns.map(([label]) => label), columns.map(([, value]) => value)]
      .map((line) => line.map(cell).join('\t'))
      .join('\n')

    setStatusError('')
    try {
      if (!navigator.clipboard) throw new Error('the clipboard is not available in this browser')
      await navigator.clipboard.writeText(tsv)
      setPricesNotice(`Copied ${data.terms.item.toLowerCase()} ${lot.identifier}.`)
    } catch (err) {
      console.error('[projects] could not copy lot row:', err)
      setStatusError(`Could not copy lot ${lot.identifier}: ${err.message}`)
    }
  }

  /** After an update or delete: close the dialog, say what happened, and re-read the table. */
  function handleLotChanged(message) {
    setLotDialog(null)
    setSelectedIds(new Set())
    setPricesNotice(message)
    reload()
  }

  /** Download every lot matching the current search, filters, and sort as a CSV. */
  async function handleExport() {
    if (exporting) return
    setPricesNotice('')
    setStatusError('')
    setExporting(true)
    try {
      const { csv, count, fileName } = await exportLotsCsv(query)
      if (!count) {
        setStatusError(`There are no ${data.terms.item.toLowerCase()}s to export.`)
        return
      }
      // The byte-order mark makes Excel read accented agent names as UTF-8.
      const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      link.rel = 'noopener'
      // Firefox and Safari only follow the click for a link that is in the document.
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)

      const filtered = Boolean(query.search || query.status || query.phase || query.category)
      const item = data.terms.item.toLowerCase()
      setPricesNotice(`Exported ${count} ${item}${count === 1 ? '' : 's'}${filtered ? ' matching the current filters' : ''}.`)
    } catch (err) {
      console.error('[projects] could not export lots:', err)
      setStatusError(`Could not export ${data.terms.item.toLowerCase()}s: ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  // The skeleton table shows the page size in view, so no rows shift on arrival.
  if (loading && !data) return <ProjectsSkeleton rows={pageSize} />

  // Reflects what the database was actually asked, not the half-typed input.
  const hasFilters = Boolean(debouncedSearch || filters.status || filters.phase || filters.category)

  return (
    /* Past the skeleton: the page itself arriving, tabs and table together. */
    <Reveal>
    <Flex direction="column" gap="16px">
      <ProjectHeader
        project={data.project}
        projects={data.projects}
        onProjectChange={handleProjectChange}
        onAction={(action) => {
          if (action === 'update-prices') {
            setPricesNotice('')
            setPricesOpen(true)
          }
          if (action === 'import-lots') {
            setPricesNotice('')
            setImportOpen(true)
          }
          if (action === 'export-lots') handleExport()
          if (action === 'add-lot') {
            setPricesNotice('')
            // Lots live in a per-project table (LOT_TABLES); without one there is nowhere to save.
            if (!data.hasLotTable) {
              setStatusError(`Lots can't be added to ${data.project.name || 'this project'} yet — it has no lot table set up.`)
              return
            }
            setStatusError('')
            setLotDialog({ type: 'add', lot: null })
          }
        }}
        view={view}
        onViewChange={handleViewChange}
        // The lot actions follow the project's wording (MSCC: "Add unit", "Export units").
        actions={PROJECT_ACTIONS.map((item) => {
          const one = data.terms.item.toLowerCase()
          if (item.value === 'add-lot') return { ...item, label: `Add ${one}` }
          if (item.value === 'import-lots') return { ...item, label: `Import ${one}s (CSV)` }
          if (item.value === 'export-lots') return { ...item, label: `Export ${one}s` }
          return item
        })}
      />

      <SourceNotice source={data.source} envVar={SUPABASE_ENV} />

      <LotImportDialog
        open={importOpen}
        projectCode={data.project.code}
        projectName={data.project.name}
        terms={data.terms}
        onClose={() => setImportOpen(false)}
        onImported={(message) => {
          setImportOpen(false)
          setSelectedIds(new Set())
          setPricesNotice(message)
          reload()
        }}
      />

      <CategoryPricesDialog
        key={data.project.code}
        open={pricesOpen}
        project={data.project}
        onClose={() => setPricesOpen(false)}
        onSaved={(repriced) => {
          setPricesNotice(
            `Prices saved for ${data.project.name}.` +
              (data.hasLotTable ? ` ${repriced} lot${repriced === 1 ? '' : 's'} re-priced.` : ''),
          )
          reload()
        }}
      />


      <LotDetailsDialog
        lot={lotDialog?.type === 'details' ? lotDialog.lot : null}
        terms={data.terms}
        projectName={data.project.name}
        onClose={() => setLotDialog(null)}
      />
      {lotDialog?.type === 'update' || lotDialog?.type === 'add' ? (
        <LotEditDialog
          key={lotDialog.lot?.id ?? 'new'}
          open
          lot={lotDialog.lot}
          projectCode={data.project.code}
          phases={data.facets.phases}
          terms={data.terms}
          onClose={() => setLotDialog(null)}
          onSaved={handleLotChanged}
        />
      ) : null}
      {bulkDelete ? (
        <LotsBulkDeleteDialog
          ids={[...selectedIds]}
          projectCode={data.project.code}
          terms={data.terms}
          onClose={() => setBulkDelete(false)}
          onDeleted={(message) => {
            setBulkDelete(false)
            handleLotChanged(message)
          }}
        />
      ) : null}
      {lotDialog?.type === 'delete' ? (
        <LotDeleteDialog
          key={lotDialog.lot.id}
          lot={lotDialog.lot}
          projectCode={data.project.code}
          onClose={() => setLotDialog(null)}
          terms={data.terms}
          onDeleted={handleLotChanged}
        />
      ) : null}

      {pricesNotice ? (
        <Text role="status" fontFamily="Inter, system-ui, sans-serif" fontSize="13px" color={COLORS.brandGreen}>
          {pricesNotice}
        </Text>
      ) : null}

      {data.source === 'database' && data.project.code && !data.hasLotTable ? (
        <Text role="status" fontFamily="Inter, system-ui, sans-serif" fontSize="13px" color={COLORS.subtle}>
          No lots are stored for {data.project.name} yet, so its figures read zero.
        </Text>
      ) : null}

      <LotStatsRow stats={data.stats} terms={data.terms} />

      {/*
        * The tab panel. `key` is the tab, so switching tabs remounts this and the
        * reveal replays; the flex column keeps the table view's stacked blocks
        * spaced as they were when they sat directly in the page.
        */}
      <Reveal key={view} animate={tabSwitched} display="flex" flexDirection="column" gap="16px">
      {view === 'map' ? (
        <ProjectMapView
          projectCode={data.project.code}
          projectName={data.project.name}
          projectId={data.project.id}
        />
      ) : view === 'project-dev' || view === 'future-dev' || view === 'flyers' ? (
        <DevGalleryView
          key={view}
          gallery={view}
          projectCode={data.project.code}
          projectName={data.project.name}
        />
      ) : (
        <>
          <LotFilters
            search={search}
            onSearchChange={handleSearchChange}
            filters={filters}
            facets={data.facets}
            onFilterChange={handleFilterChange}
            onReset={handleReset}
            sort={sort}
            onSortDirToggle={handleSortDirToggle}
            terms={data.terms}
          />

          {statusError ? (
            <Text role="alert" fontFamily="Inter, system-ui, sans-serif" fontSize="13px" color="#B91C1C">
              {statusError}
            </Text>
          ) : null}

          {/*
            * Selection is cleared whenever the page changes, so it only ever covers
            * rows on the page in view — the wording says so rather than implying the
            * whole filtered set is about to go.
            */}
          {selectedIds.size > 0 ? (
            <Flex
              role="status"
              align="center"
              justify="space-between"
              gap="12px"
              flexWrap="wrap"
              px="18px"
              py="12px"
              borderRadius="12px"
              border="1px solid"
              borderColor={COLORS.border}
              bg={COLORS.statusBg}
            >
              <Text fontFamily="Inter, system-ui, sans-serif" fontWeight="600" fontSize="13px" color={COLORS.heading}>
                {selectedIds.size} {data.terms.item.toLowerCase()}
                {selectedIds.size === 1 ? '' : 's'} selected on this page
              </Text>

              <Flex align="center" gap="8px" flexWrap="wrap">
                <Flex
                  as="button"
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  align="center"
                  h="36px"
                  px="14px"
                  borderRadius="8px"
                  bg="transparent"
                  fontFamily="Inter, system-ui, sans-serif"
                  fontWeight="500"
                  fontSize="13px"
                  color={COLORS.muted}
                  cursor="pointer"
                  _hover={{ bg: COLORS.hoverBg }}
                  _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg }}
                >
                  Clear selection
                </Flex>

                <Flex
                  as="button"
                  type="button"
                  onClick={() => {
                    setPricesNotice('')
                    setStatusError('')
                    setBulkDelete(true)
                  }}
                  align="center"
                  gap="6px"
                  h="36px"
                  px="14px"
                  borderRadius="8px"
                  bg="#DC2626"
                  fontFamily="Inter, system-ui, sans-serif"
                  fontWeight="600"
                  fontSize="13px"
                  color="#FFFFFF"
                  cursor="pointer"
                  _hover={{ bg: '#B91C1C' }}
                  _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
                >
                  <Icon as={LuTrash2} boxSize="14px" />
                  Delete selected
                </Flex>
              </Flex>
            </Flex>
          ) : null}

          <LotsTable
            lots={data.lots}
            loading={loading}
            hasFilters={hasFilters}
            selectedIds={selectedIds}
            onToggleRow={toggleRow}
            onTogglePage={togglePage}
            sort={sort}
            onSort={handleSort}
            onRowAction={handleRowAction}
            onDetails={(lot) => handleRowAction('details', lot)}
            onStatusChange={handleStatusChange}
            savingIds={savingIds}
            total={data.total}
            page={page}
            pageSize={pageSize}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
            projectName={data.project.name}
            terms={data.terms}
          />
        </>
      )}
      </Reveal>
    </Flex>
    </Reveal>
  )
}
