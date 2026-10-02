import { useState } from 'react'
import { Box, CloseButton, Dialog, Flex, Portal, Text } from '@chakra-ui/react'
import { formatBytes, UPLOAD_RULES } from '@/lib/uploadRules'
import { COLORS } from '@/theme/colors'

const FONT = 'Inter, system-ui, sans-serif'

const SECTIONS = [
  {
    id: 'start', title: 'Getting started', lead: 'Use the left navigation to move between Dashboard, Projects & Lots, and Announcements. The portal reads live project data after you sign in.',
    groups: [
      { heading: 'First steps', steps: [
        'Sign in with your portal account. Your name and role appear in the top bar.',
        'Open Dashboard for a portfolio overview. Use Filters to focus on one project.',
        'Open Projects & Lots, select a project, then choose Lot Table or Map. Use Project Actions for galleries and other management tools.',
        'Use Logout in the sidebar when you finish, especially on a shared computer.',
      ] },
      { heading: 'Saving and access', points: [
        'Actions that change data show a save result or an error. Wait for the result before leaving the page.',
        'An empty state can mean there are no records yet. A connection notice means the database could not be reached or is not configured.',
        'Only signed-in users can add and change data. Available operations also depend on the database permissions for your account.',
      ] },
    ],
  },
  {
    id: 'uploads', title: 'Uploads & file formats', lead: 'Each upload accepts only certain file types and sizes. The portal checks a file when you choose it and again before saving, and the database refuses anything outside these limits.',
    // The table itself is drawn from UPLOAD_RULES, so it always matches what is enforced.
    rules: true,
    groups: [
      { heading: 'Before you upload', steps: [
        'Check the format and size limit shown under the upload area, or in the table above.',
        'Save photos as JPG, PNG or WebP. Maps can also be SVG, which stays sharp at any zoom — export the site plan from CAD or Illustrator as SVG where you can. Convert HEIC (iPhone), GIF, BMP, TIFF or PDF files first — for example, open the file and export or save it as JPG or PNG.',
        'Reduce a file that is over the limit: resize it or export it as JPG at a lower quality. Maps should stay sharp enough to read the lot numbers.',
        'For a lot import, save the spreadsheet as CSV (Comma delimited or CSV UTF-8). Excel workbooks (.xlsx) are not accepted.',
      ] },
      { heading: 'What gets refused', points: [
        'A file whose name ends in a format that is not listed, such as .gif, .heic, .pdf, or .xlsx — or an .svg anywhere but a map.',
        'A renamed file. The portal reads the start of each file, so a GIF or SVG renamed to .png, or a workbook renamed to .csv, is still refused.',
        'An empty file, or one larger than the limit for that upload.',
        'When several gallery images are chosen at once, the accepted ones are kept and the dialog says how many were skipped.',
      ] },
    ],
  },
  {
    id: 'dashboard', title: 'Dashboard', lead: 'The dashboard summarizes the current inventory across projects. Its figures reflect the records currently stored in the portal.',
    groups: [
      { heading: 'Use the overview', steps: [
        'Choose Filters, then Overall or a project to change the dashboard scope.',
        'Read Sold Area, Total Sold Lots, Reserved Lots in Escrow, and Available Inventory for the selected scope.',
        'Use Export to download the dashboard data for the current project filter.',
        'Select View Map on Available Inventory to open the project map area.',
      ] },
      { heading: 'Charts and activity', points: [
        'Inventory and sell-through charts break down available, reserved, and sold records by project or phase.',
        'The Recent Transactions card lists sold and reserved inventory. It is not a dated transaction history because most records do not have a reliable movement date.',
        'The dashboard has no date-range filter. Most lot records do not carry a reliable movement date, so these are current totals rather than sales for a chosen period.',
      ] },
    ],
  },
  {
    id: 'lots', title: 'Projects & lots', lead: 'The Lot Table is the main place to find, add, edit, and manage lots or condominium units.',
    groups: [
      { heading: 'Find a record', steps: [
        'Choose a project from the project selector above the views.',
        'Open Lot Table. Search by identifier, category, status, and other displayed values, or use the status, phase or tower, and category filters.',
        'Click a sortable column heading to change its order. Use the page controls for more rows.',
        'Open a row’s actions to view details, update it, or delete it. Select rows for bulk deletion when needed.',
      ] },
      { heading: 'Add or update a lot', steps: [
        'Open Project Actions and choose Add lot, or use a row’s update action.',
        'Enter the identifier, phase or tower when applicable, category, area, and status. MSCC units also have unit type, floor level, view, and end-unit fields.',
        'If a lot is sold, record Sold By in the edit form. Save and confirm the success message.',
        'For a reserved lot, open its details and choose Default, Client Reserved, or Company Reserved under Reserve Type. Client Reserved also asks who reserved it (a broker or sales agent, or Other… and a name) and the client.',
        'Reserve Type changes are not saved as you pick or type. Select the check icon to save them, or the cross icon to discard them and go back to what was saved. For Client Reserved the check icon is enabled once who reserved it and the client are both chosen.',
      ] },
      { heading: 'Status and map colors', points: [
        'The status picker includes Available, Reserved, Reserved (Pending), Hold, and Sold.',
        'Under the status, a sold lot shows who sold it; a reserved lot shows its reserve type and client only. Who reserved it is in the lot’s details.',
        'A status change that affects an annotated map may open a map-color review. Review and save that update to keep the lot and map in sync.',
        'Delete and bulk delete permanently remove records. Read the confirmation dialog before proceeding.',
      ] },
    ],
  },
  {
    id: 'imports', title: 'CSV import & export', lead: 'CSV import can add new lots and update existing ones in the selected project. Review the preview before committing changes.',
    groups: [
      { heading: 'Import lots', steps: [
        'In Projects & Lots, select the correct project, then choose Project Actions → Import lots (CSV).',
        'Download the template from the import dialog and fill in its columns. Use one row per lot or unit.',
        'The template columns are lot_no, phase, category, size_sqm, status, client, payment_type, cts_doas, and sold_by. Keep the header row in the file.',
        'Choose or drop a .csv file of up to 5 MB. The preview shows new rows, updates, errors, and missing headers.',
        'Correct errors in the file and upload it again. Select Import only after reviewing the changes.',
      ] },
      { heading: 'Matching and export', points: [
        'Import matches existing records by lot number plus phase. A matching row is updated; another valid row is added.',
        'The parser accepts common header spellings. Project-specific phase codes can also be read for MVLC and ERHD.',
        'Project Actions → Export lots downloads the selected project’s lot data using the current table search and filters. Dashboard Export is a separate overview export.',
      ] },
    ],
  },
  {
    id: 'prices', title: 'Prices & categories', lead: 'Prices are set by project and category. MVLC has separate price scopes for Phase 1, Phase 2, and Phase 3.',
    groups: [
      { heading: 'Update prices', steps: [
        'Select a project in Projects & Lots.',
        'Open Project Actions → Update category prices.',
        'Choose the phase or price scope shown in the dialog, enter the price per sqm for each applicable category, and save.',
        'Review the Lot Table after saving. The portal recalculates affected lot prices from the saved category rates.',
      ] },
      { heading: 'How values appear', points: [
        'Price / sqm is the unit area rate. TCP is total contract price, calculated as area in square metres multiplied by price per sqm.',
        'Categories include Regular, Regular Corner, Prime, Prime Corner, and commercial variants where the project supports them.',
        'MSCC uses condominium unit categories: 1 Bedroom, 2 Bedroom, and 2 Bedroom Deluxe. Its unit table hides the land-style price-per-sqm and TCP columns.',
      ] },
    ],
  },
  {
    id: 'maps', title: 'Maps & annotations', lead: 'The Map view holds the project maps. Each map tab also holds that map’s lot outlines (a COCO JSON file) and Color lots.',
    groups: [
      { heading: 'Upload or view a map', steps: [
        'Select a project and open Map. Choose Whole Map, a phase or floor, or Commercial when that tab exists.',
        'Choose Add map, select its destination and a JPG, PNG, WebP or SVG image of up to 25 MB, then save. Use Replace image on an existing map to update that slot.',
        'Saving recolored lots always stores the map as SVG: the original map, never re-compressed (a JPG or PNG map is embedded as uploaded), with each colored lot written in as vector shapes, so nothing loses quality and the new colors show in the mobile app too. Scripts and links to outside files are removed from an SVG when it is uploaded.',
        'Use Open full size to inspect an image. Zoom with the buttons or Ctrl plus mouse wheel, drag to pan, and double-click to reset. When the map tab has lot outlines, Open full size shows the map with its outlines (see Lot outlines & coloring); a tab’s other maps and maps without outlines open as the plain image. A spinner shows while the map loads.',
      ] },
      { heading: 'MVLC map sections', points: [
        'MVLC has separate slots for Phase 1A, 1B, 1C, 1East, 2A, 2B, 2East, and Phase 3.',
        'The East and Phase 3 maps already in the portal stay in their own slots. Empty section tabs are ready for the corresponding images.',
      ] },
      { heading: 'Lot outlines & coloring', steps: [
        'Open the map tab, then Lot outlines → Upload COCO JSON (.json, up to 20 MB) for that map.',
        'To inspect the polygons over the map, use Open full size on the map. Show lot outlines / Hide lot outlines below the map turns on or off, together, the outlines on the map, the Image and COCO size check, the number of lots on the map (one per annotation), and the clickable list of annotations. The image and annotation dimensions must align for the polygons to land on the correct lots; when they do not, the size check stays visible even with outlines hidden.',
        'Choose Color lots to open the map ready to paint, then Save Update to write reviewed map-color changes. On a map with no outlines yet, Color lots offers to upload the COCO JSON first (recommended) or to color without it — less accurate. Without it, pick which lot each colored area is (or change it from Clicked lots); Save Update stays disabled until every colored area is linked, and then changes those lots’ statuses too. Replace or delete outlines from the Lot outlines menu, which is shown only to users who can edit.',
        'Legend colors: Default uses the standard VHBC colors. Match map legend asks you to click each swatch in the legend printed on the map (SOLD, RESERVED, HOLD, PRIME, OPEN) so painted lots use exactly those colors; Skip keeps a status’s current color. The colors are remembered for that map in this browser.',
        'While coloring, a left click paints a lot. To move the map, hold Space and drag, or drag with the middle mouse button — neither paints.',
        'While coloring, Undo and Redo step back and forward through your changes — Ctrl+Z to undo, Ctrl+Y or Ctrl+Shift+Z to redo (⌘ on a Mac). Reset colors can be undone too. More options holds the annotated-lot shape choice and Tolerance, which sets how far a lot’s color reaches; Default suits most maps.',
      ] },
    ],
  },
  {
    id: 'media', title: 'Project images & flyers', lead: 'Each project has separate image views for Project Development, Future Development, and Flyers Pictures.',
    groups: [
      { heading: 'Manage gallery images', steps: [
        'Select the project, then open Project Actions and choose Project development, Future development, Future projects, or Flyer pictures.',
        'Future Projects stores a required name, location, and image for each entry, with an optional description.',
        'Choose an existing project, or select Other / New future project to enter a project that is not yet in the portal.',
        'Use Upload images to add pictures to that view — JPG, PNG or WebP, up to 10 MB each. Open an image to inspect it.',
        'Use Replace image to change one picture, or select images and choose the delete action to remove them.',
      ] },
      { heading: 'Keep files organized', points: [
        'Upload each picture under the correct project and view; gallery pictures are separate from site maps.',
        'A view with no images shows an empty state and an upload action when the database is available.',
      ] },
    ],
  },
  {
    id: 'featured', title: 'Featured Projects', lead: 'Show one featured project with its location and one image.',
    groups: [
      { heading: 'Add or update a feature', steps: [
        'Open Projects & Lots → Project Actions → Featured project.',
        'Choose a project, enter its location, drag one image into the drop zone or click to browse, and choose Feature project.',
        'To update the current project, select Edit on its card. Change the location, replace the image if needed, then save.',
        'To feature a different project, choose it from the selector, enter its location, add an image, and select Replace featured project. This replaces the current feature.',
        'Choose Remove on the card to stop featuring the project and delete its featured image.',
      ] },
    ],
  },
  {
    id: 'announcements', title: 'Announcements', lead: 'The Announcements & Memo Hub contains company bulletins, project advisories, policy updates, and other memos.',
    groups: [
      { heading: 'Read and manage posts', steps: [
        'Open Announcements from the sidebar. Search by text or switch between Newest First and Oldest First.',
        'Choose Post New Announcement to enter a title and body and publish it.',
        'Use an announcement’s actions menu to edit or delete a post. Confirm deletion in the dialog.',
      ] },
    ],
  },
  {
    id: 'help', title: 'Common problems', lead: 'Most issues can be resolved by checking the selected project, the file contents, and the message shown after an action.',
    groups: [
      { heading: 'What to check', points: [
        'No records or images: confirm the correct project and view are selected, then clear search and filters. Check for a database connection notice.',
        'CSV import rejected: review missing headers and row errors in the preview, correct the CSV, and upload it again.',
        'Map annotations appear offset: check that the COCO JSON belongs to the selected map image and that their dimensions match.',
        'File not accepted: check its format and size against Uploads & file formats, convert or shrink it, and choose it again.',
        'Save or upload failed: read the error in the dialog, confirm you are signed in, and retry after the connection is restored.',
        'A button is unavailable: it may require a connected database, a selected file, completed required fields, or permission to edit that record.',
      ] },
    ],
  },
  {
    id: 'terms', title: 'Terminology', lead: 'These terms match the labels used throughout the portal.',
    terms: [
      ['Project / estate', 'A property development tracked in the portal, such as MVLC or MSCC.'],
      ['Lot / unit', 'An individual item for sale. Land projects use lots; MSCC uses condominium units.'],
      ['Lot identifier', 'The project-specific lot number or code used to find a record.'],
      ['Phase / tower', 'A project grouping. Land projects may use phases; MSCC uses towers.'],
      ['Section', 'A subdivision within an MVLC map phase, such as A, B, C, or East.'],
      ['Category', 'The pricing grade or unit type assigned to a lot or unit.'],
      ['sqm', 'Square metres, the unit used for lot and unit area.'],
      ['Price / sqm', 'The price for one square metre in a pricing category.'],
      ['TCP', 'Total contract price: area in sqm × price per sqm.'],
      ['Available', 'A lot or unit currently open in inventory.'],
      ['Reserved / Reserved (Pending)', 'A lot or unit held for a prospective buyer; pending is a separate stored status.'],
      ['Hold', 'A separate status for a lot that is held.'],
      ['Sold', 'A lot or unit marked as sold.'],
      ['Reserve Type', 'Whether a reserved lot is held by default, for a client, or for the company.'],
      ['Sell-through', 'The sold share of the total lots in a project or phase.'],
      ['COCO JSON', 'An annotation file containing polygon coordinates for lots on a map image.'],
      ['Annotated map', 'A map with lot polygons that can be reviewed and colored by status.'],
      ['CSV', 'A spreadsheet-compatible text file used for bulk lot import and export.'],
    ],
  },
]

export default function SystemManualDialog({ open, onClose }) {
  const [selected, setSelected] = useState(SECTIONS[0].id)
  const section = SECTIONS.find((item) => item.id === selected) ?? SECTIONS[0]

  return (
    <Dialog.Root open={open} onOpenChange={({ open: next }) => { if (!next) onClose() }} placement="center" size="xl" scrollBehavior="inside">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner px="12px" py="12px">
          <Dialog.Content maxW="960px" h={{ base: 'min(90dvh, 850px)', md: 'min(84dvh, 760px)' }} borderRadius="16px" overflow="hidden">
            <Dialog.Header py="18px" px="24px" pr="60px" borderBottom="1px solid" borderColor={COLORS.border}>
              <Dialog.Title fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif" fontSize="21px" color={COLORS.heading}>System Manual</Dialog.Title>
              <Text mt="3px" fontFamily={FONT} fontSize="13px" color={COLORS.subtle}>How to use the VHBC Portal and understand its terms</Text>
            </Dialog.Header>
            <Dialog.CloseTrigger asChild top="18px" right="18px"><CloseButton size="sm" aria-label="Close system manual" /></Dialog.CloseTrigger>
            <Dialog.Body p={0} minH={0} display="flex" flexDirection={{ base: 'column', md: 'row' }}>
              <Flex as="nav" aria-label="Manual sections" direction={{ base: 'row', md: 'column' }} gap="4px" p="12px" w={{ base: 'full', md: '214px' }} flexShrink={0} overflowX={{ base: 'auto', md: 'hidden' }} overflowY={{ base: 'hidden', md: 'auto' }} borderBottom={{ base: '1px solid', md: '0' }} borderRight={{ base: '0', md: '1px solid' }} borderColor={COLORS.border} bg={COLORS.canvas}>
                {SECTIONS.map((item) => (
                  <Box as="button" type="button" key={item.id} onClick={() => setSelected(item.id)} aria-current={section.id === item.id ? 'true' : undefined} whiteSpace="nowrap" textAlign="left" px="12px" py="9px" borderRadius="8px" fontFamily={FONT} fontSize="13px" fontWeight={section.id === item.id ? '700' : '500'} color={section.id === item.id ? COLORS.brandGreen : COLORS.heading} bg={section.id === item.id ? COLORS.surface : 'transparent'} cursor="pointer" _hover={{ bg: COLORS.hoverBg }} _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg }}>
                    {item.title}
                  </Box>
                ))}
              </Flex>
              <Box key={section.id} flex="1" minW={0} overflowY="auto" px={{ base: '20px', md: '32px' }} py="24px" fontFamily={FONT}>
                <Text as="h2" fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif" fontSize="24px" fontWeight="700" color={COLORS.heading}>{section.title}</Text>
                <Text mt="10px" fontSize="14px" lineHeight="1.7" color={COLORS.muted}>{section.lead}</Text>
                {section.rules ? (
                  <Box mt="20px" border="1px solid" borderColor={COLORS.border} borderRadius="10px" overflow="hidden">
                    {Object.entries(UPLOAD_RULES).map(([kind, rule], index) => (
                      <Flex key={kind} direction={{ base: 'column', sm: 'row' }} gap={{ base: '4px', sm: '16px' }} px="16px" py="12px" borderTop={index ? '1px solid' : '0'} borderColor={COLORS.border}>
                        <Box flex="1" minW={0}>
                          <Text fontSize="14px" fontWeight="700" color={COLORS.heading}>{rule.label}</Text>
                          <Text mt="2px" fontSize="12.5px" lineHeight="1.5" color={COLORS.subtle}>{rule.usedFor}</Text>
                        </Box>
                        <Box flexShrink={0} textAlign={{ base: 'left', sm: 'right' }}>
                          <Text fontSize="13.5px" fontWeight="600" color={COLORS.heading}>{rule.formats}</Text>
                          <Text mt="2px" fontSize="12.5px" color={COLORS.subtle}>Up to {formatBytes(rule.maxBytes)}</Text>
                        </Box>
                      </Flex>
                    ))}
                  </Box>
                ) : null}
                {section.groups?.map((group) => (
                  <Box key={group.heading} mt="28px">
                    <Text as="h3" fontSize="16px" fontWeight="700" color={COLORS.heading}>{group.heading}</Text>
                    {group.steps ? <Box as="ol" mt="10px" pl="22px" color={COLORS.muted} fontSize="14px" lineHeight="1.7" css={{ '& li': { paddingLeft: '4px', marginBottom: '8px' } }}>{group.steps.map((step) => <li key={step}>{step}</li>)}</Box> : null}
                    {group.points ? <Box as="ul" mt="10px" pl="22px" color={COLORS.muted} fontSize="14px" lineHeight="1.7" css={{ '& li': { paddingLeft: '4px', marginBottom: '8px' } }}>{group.points.map((point) => <li key={point}>{point}</li>)}</Box> : null}
                  </Box>
                ))}
                {section.terms ? <Box as="dl" mt="22px">{section.terms.map(([term, meaning]) => <Box key={term} py="11px" borderBottom="1px solid" borderColor={COLORS.border}><Text as="dt" fontSize="14px" fontWeight="700" color={COLORS.heading}>{term}</Text><Text as="dd" mt="3px" ml={0} fontSize="13px" lineHeight="1.6" color={COLORS.muted}>{meaning}</Text></Box>)}</Box> : null}
              </Box>
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}
