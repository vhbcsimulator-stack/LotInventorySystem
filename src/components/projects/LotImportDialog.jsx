import { useRef, useState } from 'react'
import { Box, CloseButton, Dialog, Flex, Icon, Portal, Spinner, Text } from '@chakra-ui/react'
import { LuDownload, LuFileSpreadsheet, LuTriangleAlert } from 'react-icons/lu'
import { CSV_TEMPLATE, commitLotImport, previewLotImport } from '@/data/lotImportData'
import { DEFAULT_LOT_TERMS } from '@/data/projectsData'
import { COLORS } from '@/theme/colors'
import { formatDate, formatNumber } from '@/utils/format'
import { notifyFailed, notifySaved } from '@/lib/notify'
import { acceptFor, describeUpload, uploadProblem } from '@/lib/uploadRules'

const FONT = 'Inter, system-ui, sans-serif'
const PREVIEW_ROWS = 50

function Button({ children, tone = 'neutral', loading, icon, ...rest }) {
  const tones = {
    neutral: { bg: COLORS.surface, color: COLORS.heading, borderColor: COLORS.border, hover: COLORS.hoverBg },
    primary: { bg: COLORS.brandGreen, color: '#FFFFFF', borderColor: COLORS.brandGreen, hover: '#00541F' },
  }
  const { hover, ...style } = tones[tone]
  return (
    <Flex
      as="button"
      type="button"
      align="center"
      gap="6px"
      h="38px"
      px="16px"
      borderRadius="8px"
      border="1px solid"
      fontFamily={FONT}
      fontWeight="600"
      fontSize="14px"
      cursor="pointer"
      _hover={{ bg: hover }}
      _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}
      {...style}
      {...rest}
    >
      {loading ? <Spinner size="xs" /> : icon ? <Icon as={icon} boxSize="15px" /> : null}
      {children}
    </Flex>
  )
}

function Stat({ label, value, color = COLORS.heading }) {
  return (
    <Box flex="1" minW="90px" p="10px 12px" borderRadius="10px" bg={COLORS.canvas}>
      <Text fontFamily={FONT} fontSize="11.5px" color={COLORS.subtle}>
        {label}
      </Text>
      <Text fontFamily={FONT} fontWeight="700" fontSize="18px" color={color}>
        {formatNumber(value)}
      </Text>
    </Box>
  )
}

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: 'text/csv' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'lots-import-template.csv'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const Cell = (props) => <Box as="td" px="10px" py="6px" whiteSpace="nowrap" {...props} />

/**
 * Import lots from a CSV: choose or drop a file, review what will be added,
 * updated and rejected, then write. Nothing is saved before "Import".
 */
export default function LotImportDialog({ open, projectCode, projectName, terms = DEFAULT_LOT_TERMS, onClose, onImported }) {
  const item = terms.item.toLowerCase()
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [stage, setStage] = useState('idle') // idle | checking | ready | importing
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  // The preview shows the first PREVIEW_ROWS rows until every row is asked for.
  const [showAllRows, setShowAllRows] = useState(false)
  const input = useRef(null)

  const busy = stage === 'checking' || stage === 'importing'

  function reset() {
    setFile(null)
    setPreview(null)
    setStage('idle')
    setError('')
    setProgress({ done: 0, total: 0 })
    setShowAllRows(false)
  }

  async function choose(nextFile) {
    if (!nextFile) return
    const problem = uploadProblem('csv', nextFile)
    if (problem) {
      setError(problem)
      return
    }
    setFile(nextFile)
    setPreview(null)
    setError('')
    setShowAllRows(false)
    setStage('checking')
    try {
      setPreview(await previewLotImport(projectCode, nextFile))
      setStage('ready')
    } catch (err) {
      setError(err.message)
      setStage('idle')
    }
  }

  async function handleImport() {
    setStage('importing')
    setError('')
    setProgress({ done: 0, total: preview.rows.length })
    try {
      const { inserted, updated } = await commitLotImport(projectCode, preview.rows, (done, total) =>
        setProgress({ done, total }),
      )
      reset()
      notifySaved(`${item[0].toUpperCase()}${item.slice(1)}s imported`, `${formatNumber(inserted)} added, ${formatNumber(updated)} updated.`)
      onImported(`Imported ${item}s: ${formatNumber(inserted)} added, ${formatNumber(updated)} updated.`)
    } catch (err) {
      setError(err.message)
      notifyFailed('Import failed', err)
      setStage('ready')
    }
  }

  const canImport = stage === 'ready' && preview && preview.rows.length > 0 && !preview.missingHeaders.length

  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open: next }) => {
        if (!next && !busy) {
          reset()
          onClose()
        }
      }}
      placement="center"
      size="xl"
      scrollBehavior="inside"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner px="16px">
          <Dialog.Content borderRadius="16px" maxH="calc(100dvh - 32px)">
            <Dialog.Header borderBottom="1px solid" borderColor={COLORS.border} py="18px" pr="56px">
              <Dialog.Title fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif" fontSize="18px" color={COLORS.heading}>
                Import {terms.item.toLowerCase()}s (CSV){projectName ? ` — ${projectName}` : ''}
              </Dialog.Title>
            </Dialog.Header>

            <Dialog.Body py="18px">
              <Flex
                as="button"
                type="button"
                direction="column"
                align="center"
                justify="center"
                gap="4px"
                w="100%"
                minH={preview ? '110px' : '200px'}
                px="16px"
                borderRadius="12px"
                border="2px dashed"
                borderColor={dragOver ? COLORS.activeBg : '#9AA3AF'}
                bg={dragOver ? COLORS.statusBg : COLORS.surface}
                cursor={busy ? 'not-allowed' : 'pointer'}
                disabled={busy}
                onClick={() => input.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault()
                  if (!busy) setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(event) => {
                  event.preventDefault()
                  setDragOver(false)
                  if (!busy) choose(event.dataTransfer.files?.[0])
                }}
              >
                {stage === 'checking' ? (
                  <Spinner size="md" color={COLORS.brandGreen} />
                ) : (
                  <Icon as={LuFileSpreadsheet} boxSize="34px" color={COLORS.subtle} />
                )}
                <Text fontFamily={FONT} fontSize="15px" color={COLORS.heading} mt="4px" overflowWrap="anywhere">
                  {file ? file.name : 'Drag and drop a CSV file here'}
                </Text>
                <Text fontFamily={FONT} fontSize="13px" color={COLORS.subtle}>
                  {stage === 'checking' ? 'Checking rows…' : file ? 'Click to choose a different file' : 'or click to browse'}
                </Text>
                <Text fontFamily={FONT} fontSize="12px" color={COLORS.subtle}>
                  {describeUpload('csv')}
                </Text>
              </Flex>
              <input
                ref={input}
                type="file"
                accept={acceptFor('csv')}
                hidden
                onChange={(event) => {
                  choose(event.target.files?.[0])
                  event.target.value = ''
                }}
              />

              <Flex mt="10px" align="center" justify="space-between" gap="10px" wrap="wrap">
                <Text fontFamily={FONT} fontSize="12px" color={COLORS.subtle} flex="1" minW="240px">
                  Columns: <b>lot_no</b>
                  {terms.group ? (
                    <>
                      , <b>phase</b> ({projectCode === 'MVLC' ? 'MVLC code such as MV-1A or MV 1 E' : `${terms.group.toLowerCase()} number`})
                    </>
                  ) : null}
                  , <b>category</b>, <b>size_sqm</b>, and optional status, client, sold_by, and a date (year/month
                  or a full RSV date). {terms.item}s with the same number{terms.group ? ` and ${terms.group.toLowerCase()}` : ''}{' '}
                  are updated. Sheets that write the category into the phase column need no category column: P is Prime,
                  PC Prime Corner, C Regular Corner, and no marker at all (just ERHD) is Regular — e.g. ERHD-PC, ERHD-P,
                  ERHD-C, ERHD, or MV PH1E-C for commercial. The sales sheets' own headings — LOT, Lot Area, SD/SM/REALTY, RSV
                  DATE — are read as well. The price per sqm is never taken from the file: every {item} gets its
                  category&apos;s price from Category prices, and TCP follows from it. For an RSV row, a Client value of
                  Company creates a Company Reserve, a blank Client creates a Default Reserve, and any other Client value creates a
                  Client Reserve and is saved as the client name.
                </Text>
                <Box
                  as="button"
                  type="button"
                  display="flex"
                  alignItems="center"
                  gap="6px"
                  fontFamily={FONT}
                  fontWeight="600"
                  fontSize="12.5px"
                  color={COLORS.activeBg}
                  cursor="pointer"
                  _hover={{ textDecoration: 'underline' }}
                  onClick={downloadTemplate}
                >
                  <Icon as={LuDownload} boxSize="14px" />
                  Download template
                </Box>
              </Flex>

              {preview?.missingHeaders.length ? (
                <Flex mt="14px" gap="8px" p="12px" borderRadius="10px" bg="#FDECEC" align="flex-start">
                  <Icon as={LuTriangleAlert} color="#B91C1C" mt="2px" />
                  <Text fontFamily={FONT} fontSize="13px" color="#7F1D1D">
                    The file is missing required columns: <b>{preview.missingHeaders.join(', ')}</b>. Add them (see the
                    template) and choose the file again.
                  </Text>
                </Flex>
              ) : null}

              {preview && !preview.missingHeaders.length ? (
                <>
                  <Flex mt="14px" gap="10px" wrap="wrap">
                    <Stat label="Rows in file" value={preview.counts.total} />
                    <Stat label={`New ${item}s`} value={preview.counts.insert} color={COLORS.brandGreen} />
                    <Stat label="Updates" value={preview.counts.update} color={COLORS.activeBg} />
                    <Stat
                      label="Errors (skipped)"
                      value={preview.errors.length}
                      color={preview.errors.length ? '#B91C1C' : COLORS.heading}
                    />
                  </Flex>

                  {preview.errors.length ? (
                    <Box mt="14px" border="1px solid" borderColor="#F5C2C2" borderRadius="10px" maxH="160px" overflowY="auto">
                      {preview.errors.map((item) => (
                        <Text
                          key={item.rowNumber}
                          px="12px"
                          py="6px"
                          fontFamily={FONT}
                          fontSize="12.5px"
                          color="#7F1D1D"
                          borderBottom="1px solid"
                          borderColor="#FBE3E3"
                        >
                          <b>Row {item.rowNumber}</b>
                          {item.lotNo ? ` (${item.lotNo})` : ''}: {item.problems.join('; ')}
                        </Text>
                      ))}
                    </Box>
                  ) : null}

                  {preview.rows.length ? (
                    <Box mt="14px" border="1px solid" borderColor={COLORS.border} borderRadius="10px" overflow="auto" maxH="260px">
                      <Box as="table" w="100%" fontFamily={FONT} fontSize="12.5px" style={{ borderCollapse: 'collapse' }}>
                        <Box as="thead" position="sticky" top="0" bg={COLORS.canvas}>
                          <tr>
                            {['Row', 'Action', terms.item, terms.group, 'Category', 'Area', 'Status', 'Last Updated']
                              .filter(Boolean)
                              .map((head) => (
                              <Box as="th" key={head} textAlign="left" px="10px" py="8px" color={COLORS.subtle} fontWeight="600" whiteSpace="nowrap">
                                {head}
                              </Box>
                            ))}
                          </tr>
                        </Box>
                        <tbody>
                          {(showAllRows ? preview.rows : preview.rows.slice(0, PREVIEW_ROWS)).map((row) => (
                            <Box as="tr" key={row.rowNumber} borderTop="1px solid" borderColor={COLORS.border}>
                              <Cell color={COLORS.subtle}>{row.rowNumber}</Cell>
                              <Cell fontWeight="600" color={row.id ? COLORS.activeBg : COLORS.brandGreen}>
                                {row.id ? 'Update' : 'New'}
                              </Cell>
                              <Cell>{row.lot_no}</Cell>
                              {terms.group ? <Cell>{row.phase_label ?? row.phase ?? '—'}</Cell> : null}
                              <Cell>{row.category}</Cell>
                              <Cell>{formatNumber(row.size_sqm)} sqm</Cell>
                              <Cell>
                                {row.status}
                                {row.reserve_type === 'company' ? ` · Company Reserve${row.reserved_for ? ` · ${row.reserved_for}` : ''}` : ''}
                                {row.reserve_type === 'client' ? ` · Client Reserve · ${row.reserved_for}` : ''}
                                {row.sold_by ? ` · ${row.sold_by}` : ''}
                              </Cell>
                              {/* Blank when the sheet gave no YEAR/MONTH, matching what will be stored. */}
                              <Cell color={row.date ? COLORS.heading : COLORS.subtle}>
                                {row.date ? formatDate(row.date, { precision: row.precision || 'day' }) : '—'}
                              </Cell>
                            </Box>
                          ))}
                        </tbody>
                      </Box>
                      {preview.rows.length > PREVIEW_ROWS ? (
                        <Box
                          as="button"
                          type="button"
                          onClick={() => setShowAllRows((previous) => !previous)}
                          display="block"
                          w="100%"
                          px="10px"
                          py="8px"
                          textAlign="left"
                          fontFamily={FONT}
                          fontWeight="600"
                          fontSize="12px"
                          color={COLORS.activeBg}
                          cursor="pointer"
                          borderTop="1px solid"
                          borderColor={COLORS.border}
                          _hover={{ textDecoration: 'underline' }}
                        >
                          {showAllRows
                            ? `Show only the first ${PREVIEW_ROWS} rows`
                            : `View all ${formatNumber(preview.rows.length)} rows to be uploaded`}
                        </Box>
                      ) : null}
                    </Box>
                  ) : null}
                </>
              ) : null}

              {error ? (
                <Text role="alert" mt="12px" fontFamily={FONT} fontSize="13px" color="#B91C1C">
                  {error}
                </Text>
              ) : null}
            </Dialog.Body>

            <Dialog.Footer borderTop="1px solid" borderColor={COLORS.border} py="16px" gap="10px" flexWrap="wrap">
              <Button disabled={busy || !file} onClick={reset}>
                Clear
              </Button>
              <Button tone="primary" loading={stage === 'importing'} disabled={!canImport} onClick={handleImport}>
                {stage === 'importing'
                  ? `Importing ${formatNumber(progress.done)} of ${formatNumber(progress.total)}…`
                  : preview?.rows.length
                    ? `Import ${formatNumber(preview.rows.length)} ${preview.rows.length === 1 ? item : `${item}s`}`
                    : 'Import'}
              </Button>
            </Dialog.Footer>
            <Dialog.CloseTrigger asChild top="14px" right="14px">
              <CloseButton size="sm" disabled={busy} />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}
