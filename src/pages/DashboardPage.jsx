import { useMemo, useState } from 'react'
import { Box, Flex, Grid, Text } from '@chakra-ui/react'
import useDashboard from '@/hooks/useDashboard'
import DashboardSkeleton from '@/components/skeletons/DashboardSkeleton'
import { Reveal } from '@/components/ui-kit/Reveal'
import PortfolioHero from '@/components/dashboard/PortfolioHero'
import KpiRow from '@/components/dashboard/KpiRow'
import SellThroughCard from '@/components/dashboard/SellThroughCard'
import InventoryByEstateCard from '@/components/dashboard/InventoryByEstateCard'
import PortfolioDistributionCard from '@/components/dashboard/PortfolioDistributionCard'
import RecentTransactionsCard from '@/components/dashboard/RecentTransactionsCard'
import AnnouncementsCard from '@/components/dashboard/AnnouncementsCard'
import SourceNotice from '@/components/SourceNotice'
import { summarize } from '@/data/dashboardData'
import { DEFAULT_PROJECT_CODE } from '@/data/projectsData'
import { SUPABASE_ENV } from '@/data/supabase'
import { COLORS } from '@/theme/colors'
import { notifyFailed } from '@/lib/notify'

const workbookHeader = (value) => ({ value, fontWeight: 'bold', textColor: '#FFFFFF', backgroundColor: '#00652C' })

function workbookSheet(title, headers, rows, widths, metadata) {
  return {
    sheet: title,
    data: [
      [{ value: title, fontWeight: 'bold', fontSize: 16, textColor: '#0B1C30', columnSpan: headers.length }],
      ['Generated', metadata.generated],
      ['Project filter', metadata.project],
      [null],
      headers.map(workbookHeader),
      ...rows,
    ],
    columns: widths.map((width) => ({ width })),
    stickyRowsCount: 5,
  }
}

function CenteredNotice({ children }) {
  return (
    <Flex align="center" justify="center" minH="320px" direction="column" gap="10px">
      {children}
    </Flex>
  )
}

/**
 * `onNavigate` is how a card sends the reader on to the page it summarises; the
 * app switches pages by state, so there is no URL to link to.
 */
export default function DashboardPage({ onNavigate }) {
  /*
   * What the hero's Filters menu and the transactions table both act on. The
   * page owns it so the menu, the table and the export all describe the same
   * set of movements rather than each keeping its own idea.
   *
   * There is no date range beside it any more: the only date the lot tables
   * hold is `last_updated`, which is empty on most rows and never recorded when
   * a lot moved, so every window built on it hid stock rather than narrowing it.
   */
  const [project, setProject] = useState('overall')
  const [exporting, setExporting] = useState(false)
  const { data, loading, error, reload, refresh } = useDashboard()
  const filters = useMemo(() => ({ project }), [project])

  /*
   * Every card is derived here, from the one list of lots the fetch returned, so
   * the range switch and the filter menu move the whole page at once — and
   * changing a filter costs a re-summarise rather than a round trip.
   */
  const view = useMemo(() => summarize(data?.lots ?? [], filters), [data?.lots, filters])

  /** Export each dashboard section as its own worksheet in one Excel workbook. */
  async function exportDashboard() {
    if (exporting) return
    setExporting(true)
    try {
      const { default: writeExcelFile } = await import('write-excel-file/browser')
      const date = new Date()
      const metadata = {
        generated: date.toISOString().slice(0, 16).replace('T', ' '),
        project: project === 'overall' ? 'All projects' : project,
      }
      const sheets = [
        workbookSheet(
          'Sell-Through by Phase',
          ['Estate', 'Phase', 'Sold', 'Reserved', 'Open', 'Total', '% Sold'],
          view.sellThrough.flatMap((estate) => [
            [estate.label, 'All', estate.sold, estate.reserved, estate.open, estate.total, Math.round(estate.soldPct)],
            ...estate.phases.map((phase) => [estate.label, phase.label, phase.sold, phase.reserved, phase.open, phase.total, Math.round(phase.soldPct)]),
          ]),
          [24, 18, 12, 12, 12, 12, 12],
          metadata,
        ),
        workbookSheet(
          'Inventory by Estate',
          ['Project', 'Sold', 'Reserved', 'Available', 'Total'],
          view.estates.map((estate) => [estate.name, estate.sold, estate.reserved, estate.open, estate.total]),
          [30, 14, 14, 14, 14],
          metadata,
        ),
        workbookSheet(
          'Portfolio Distribution',
          ['Scope', 'Lots', 'Available', 'Reserved', 'Sold', 'Total Area (sqm)'],
          view.distributions.map((entry) => [entry.label, entry.activeLots, entry.available, entry.reserved, entry.sold, entry.totalAreaSqm]),
          [28, 12, 14, 14, 12, 20],
          metadata,
        ),
        workbookSheet(
          'Sold & Reserved Lots',
          ['Project', 'Lot', 'Status', 'Lot Area (sqm)'],
          view.transactions.rows.map((row) => [row.projectName, row.property, row.status, row.areaSqm]),
          [30, 22, 16, 20],
          metadata,
        ),
      ]

      await writeExcelFile(sheets).toFile(`dashboard-${project}-${date.toISOString().slice(0, 10)}.xlsx`)
    } catch (err) {
      notifyFailed('Could not export dashboard', err)
    } finally {
      setExporting(false)
    }
  }

  // A skeleton in the page's own shape, so the cards do not jump into place.
  if (loading && !data) return <DashboardSkeleton />

  if (error) {
    return (
      <CenteredNotice>
        <Text
          fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif"
          fontWeight="600"
          fontSize="16px"
          color={COLORS.heading}
        >
          Could not load the dashboard
        </Text>
        <Text fontFamily="Inter, system-ui, sans-serif" fontSize="13px" color={COLORS.subtle}>
          {error.message}
        </Text>
        <Text
          as="button"
          type="button"
          onClick={reload}
          mt="4px"
          fontFamily="Inter, system-ui, sans-serif"
          fontWeight="600"
          fontSize="13px"
          color={COLORS.activeBg}
          cursor="pointer"
          _hover={{ textDecoration: 'underline' }}
        >
          Try again
        </Text>
      </CenteredNotice>
    )
  }

  return (
    /* The skeleton is gone by here, so the reveal is the real dashboard arriving. */
    <Reveal>
    <Flex direction="column" gap="16px" opacity={loading ? 0.6 : 1} transition="opacity 120ms ease">
      <PortfolioHero
        projects={data.projects ?? []}
        project={project}
        onProjectChange={setProject}
        onRefresh={refresh}
        onExport={exportDashboard}
        exporting={exporting}
      />

      <SourceNotice source={data.source} envVar={SUPABASE_ENV} />

      {/*
        * Which projects these figures actually cover. A lot table that could not
        * be read is left out of every total above, so saying so is the only way a
        * partial portfolio is not mistaken for the whole one.
        */}
      {data.coverage?.unavailable?.length ? (
        <Text role="status" fontFamily="Inter, system-ui, sans-serif" fontSize="12.5px" color="#B45309">
          Covering {data.coverage.projects} project{data.coverage.projects === 1 ? '' : 's'} — no lots could be read for{' '}
          {data.coverage.unavailable.join(', ')}.
        </Text>
      ) : null}

      <KpiRow
        headline={view.headline}
        // The map of the project the filter picked; "overall" has no map of its own,
        // so it opens the default project's.
        onViewMap={() =>
          onNavigate?.('projects', {
            initialView: 'map',
            initialProjectCode: project === 'overall' ? DEFAULT_PROJECT_CODE : project,
          })
        }
      />

      {/* Sell-through gets the wider column; estate composition sits beside it. */}
      <Grid gap="16px" templateColumns={{ base: '1fr', xl: 'minmax(0, 1.55fr) minmax(0, 1fr)' }}>
        <SellThroughCard sellThrough={view.sellThrough} />
        <InventoryByEstateCard
          estates={view.estates}
          totalUnits={view.estatesTotalUnits}
          onExplore={() => onNavigate?.('projects', { initialView: 'table' })}
        />
      </Grid>

      <Grid gap="16px" templateColumns={{ base: '1fr', xl: 'minmax(0, 1fr) minmax(0, 2fr)' }}>
        <PortfolioDistributionCard distribution={view.distribution} distributions={view.distributions} />
        {/* Already narrowed by the page, so the card only searches and pages. */}
        <RecentTransactionsCard
          transactions={{ ...view.transactions, projects: data.projects ?? [] }}
          filters={filters}
          onProjectChange={setProject}
        />
      </Grid>

      {/* The other half of what the portal holds: the announcements board. */}
      <AnnouncementsCard announcements={data.announcements} onOpen={() => onNavigate?.('announcements')} />

      <Box h="4px" />
    </Flex>
    </Reveal>
  )
}
