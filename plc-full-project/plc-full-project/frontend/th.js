/* ═══════════════════════════════════════════════════════
   i18n — ภาษาไทย (TH)
   ═══════════════════════════════════════════════════════ */
window.I18N_TH = {
  // ─── Sidebar ───
  factory:'โรงงาน',
  floor:'ชั้น',
  selectFloor:'-- เลือกชั้น --',
  startHint:'เลือกโรงงานเพื่อเริ่มต้น<br><span style="font-size:9px;color:#444c56">กด <b>F</b> เปิด/ปิดแท็บนี้ &bull; <b>?</b> ดูปุ่มลัด</span>',
  selectFloorHint:'เลือกชั้นเพื่อดูแผนที่',
  totalMachines:'จำนวนเครื่องจักรทั้งหมด',
  comingSoon:'(เร็วๆ นี้)',

  // ─── Machine status ───
  loader:'Loader',
  unloader:'Unloader',
  run:'RUN',
  idle:'IDLE',
  down:'DOWN',

  // ─── Map / Legend ───
  selectMap:'เลือกโรงงานและชั้นเพื่อดูแผนที่',
  legendIdle:'IDLE',
  legendDown:'DOWN / Error',
  overview:'ภาพรวม',

  // ─── Tooltip / Popup ───
  type:'ประเภท',
  zone:'โซน',
  error:'Error',
  updated:'อัพเดต',
  mode:'โหมด',
  alarm:'การแจ้งเตือน',
  alarmCategory:'ระดับการแจ้งเตือน',
  productId:'รหัสสินค้า',
  lotQty:'LOT ID',
  lotStartLabel:'เวลาเริ่ม LOT',
  lotEndLabel:'เวลาสิ้นสุด LOT',
  totalSheet:'จำนวนชิ้นงาน',
  pctQr:'% QR',
  date:'วัน/เดือน/ปี',
  status:'สถานะ',
  statusHistory:'ประวัติสถานะ',
  noHistory:'ยังไม่มีประวัติสถานะ',

  // ─── QR Code ───
  qrRead:'QR Code ที่อ่านได้',
  qrCodeRead:'QR Code ที่อ่านได้',

  // ─── Connection ───
  connected:'เชื่อมต่อแล้ว',
  disconnected:'ขาดการเชื่อมต่อ',
  demoMode:'Demo',
  lastUpdate:'อัพเดตล่าสุด:',

  // ─── Search ───
  search:'ค้นหาเครื่อง...',
  noResults:'ไม่พบเครื่อง',

  // ─── Alerts ───
  alertNotif:'การแจ้งเตือน',
  noAlerts:'ไม่มีการแจ้งเตือน',

  // ─── Keyboard shortcuts ───
  kbEsc:'ปิด popup',
  kbZoom:'ซูม',
  kbReset:'รีเซ็ตซูม',
  kbSidebar:'ซ่อน/แสดงแท็บ',
  kbScreenshot:'ถ่ายภาพ',
  kbSearch:'ค้นหา',
  kbThis:'ปุ่มลัดนี้',

  // ─── Daily Summary ───
  dailySummary:'📊 สรุปรายวัน (3 วัน)',
  lots:'ล็อต',
  panels:'แผ่นงาน',
  alarms:'การแจ้งเตือน',
  loading:'⏳ กำลังโหลด...',
  loadError:'❌ โหลดไม่ได้',
  noData:'— ไม่มีข้อมูล —',
  hasData:'เครื่องมีข้อมูล',
  noMachineData:'ยังไม่มีข้อมูล',
  others:'อื่นๆ',
  pcs:'ชิ้น',

  // ─── Info Panel sections ───
  machineInfo:'ข้อมูลเครื่องจักร',
  qrHistory:'QR Code History',
  qrHistoryByLot:'QR History (ราย LOT)',
  pctQrHistory:'% QR ย้อนหลัง',
  lotStartTime:'เวลาเริ่ม LOT',
  lotEndTime:'เวลาจบ LOT',

  // ─── Date range ───
  today:'วันนี้',
  lastMonth:'1 เดือนล่าสุด',
  latest100:'100 ล่าสุด',
  allData:'ทั้งหมด',
  perPage100:'หน้าละ 100',
  exportCsv:'⬇ CSV',
  fullscreen:'⤢',
  loadMore:'⬇ โหลดเพิ่ม (อีก 100)',
  loadMore:'⬇ โหลดเพิ่ม (อีก 100)',

  // ─── Machine Info history picker ───
  viewHistoryDate:'ดูข้อมูลย้อนหลัง',
  noMachineHistData:'ไม่มีข้อมูลของเครื่องในวันที่เลือก',
  histBadge:'ดูข้อมูลวันที่',
  machineDateTitle:'เลือกวันที่ดูข้อมูลย้อนหลัง',
  machineDateTodayTitle:'กลับเป็นข้อมูลสดวันนี้',

  // ─── NO_DATA ───
  noDataMachine:'— เครื่องไม่มีข้อมูลล่าสุด —',
  noDataPanel:'— NO DATA —',
  noMachineSelected:'— คลิกเครื่องเพื่อดูข้อมูล —',
  noQrData:'— ไม่มี QR Code ในช่วงนี้ —',
  producing:'กำลังผลิต...',
  startLabel:'เริ่ม',
  endLabel:'จบ',

  // ─── Button titles (tooltips) ───
  zoomIn:'ซูมเข้า (+)',
  zoomOut:'ซูมออก (-)',
  zoomReset:'รีเซ็ตซูม (0)',
  screenshot:'ถ่ายภาพ (P)',
  zoneEditor:'แก้ไขโซน',
  zoneToggle:'แสดง/ซ่อนโซน',
  zoneExport:'ส่งออกโซน (E)',
  machineDrag:'ลากเครื่อง (M)',
  machineExport:'ส่งออกตำแหน่งเครื่อง',
  refreshBtn:'รีเฟรช',
  closeBtn:'ปิด',
  exportCsvTitle:'ส่งออก CSV',
  fullscreenTitle:'ขยายเต็มจอ',

  // ─── Admin mode ───
  adminTitle:'🔐 โหมดแอดมิน',
  adminPassword:'รหัสผ่าน',
  adminLoginError:'รหัสผ่านไม่ถูกต้อง',
  adminLoginBtn:'เข้าสู่ระบบ',
  adminCancelBtn:'ยกเลิก',
  adminToolbarTitle:'🔐 แอดมิน',
  adminDrawZone:'วาดโซน',
  adminMoveMachine:'ย้ายเครื่อง',
  adminExportZones:'Export โซน',
  adminExportMachines:'Export เครื่อง',
  adminToggleZones:'แสดง/ซ่อนโซน',
  adminExit:'ออก Admin',

  // ─── Hints ───
  zoneEditHint:'คลิกหลายจุดเพื่อวาดโซน · กด Enter เพื่อจบ · กด Esc เพื่อยกเลิก · คลิกจุดแดงเพื่อลบ',
  machineDragHint:'ลากเครื่องไปตำแหน่งใหม่ · กด Esc เพื่อออก · กด ⬆M เพื่อ Export',

  // ─── QR Fullscreen ───
  qrFullscreenTitle:'QR History',

  // ─── Zone Export Modal ───
  zoneExportTitle:'⬆ Export Zone Presets — คัดลอกโค้ดไปวางใน index.html',
  zoneExportDesc:'วางโค้ดนี้แทนที่ <code style="color:var(--accent)">ZONE_PRESETS</code> ใน index.html → ทุกคนจะเห็นโซนเดียวกัน',
  zoneExportCopy:'📋 คัดลอก',
  machineExportTitle:'⬆M Export Machine Positions — คัดลอกโค้ดไปวางใน index.html',

  // ─── Zone names ───
  zoneTempOffice:'ห้องชั่วคราว',
  zoneDrilling:'เจาะ',
  zoneLamination:'อัด/ลามิเนต',
  zonePressMachine:'เครื่องอัด',
  zoneTraywashing:'ทำความสะอาดtray',
  zonePlasma:'Plasma',
  zonePTCopperPlating:'ชุบทองแดงก่อน',
  zoneCopperPlating:'ชุบทองแดง',
  zoneCopperPlatingII:'ชุบทองแดง 2',
  zone16AxisGrinding:'เจียร 16 แกน',
  zonePlugHole:'อุดรู',
  zoneVCP:'VCP',
  zoneDESInnerLayer:'DES ชั้นใน',
  zoneInnerOuterLayer:'ชั้นใน/นอก',
  zoneAOI:'AOI',
  zoneDES:'DES',
  zoneRouting:'ตัด/ทำรูป',
  zoneSurfaceTreatment:'บำบัดพื้นผิว',
  zoneSolderMask:'เคลือบต้านทอน',
  zoneETestFinalInspection:'ทดสอบไฟฟ้า/ตรวจสุดท้าย',
  zoneElectroplating:'ชุบไฟฟ้า',
  zoneLayer:'ชั้นเส้นทาง',
  zoneCopperPlating2:'ชุบทองแดง',

};
