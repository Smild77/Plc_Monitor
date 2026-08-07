/* ═══════════════════════════════════════════════════════
   i18n — 中文 (CH)
   ═══════════════════════════════════════════════════════*/
window.I18N_CH = {
  // ─── Sidebar ───
  factory:'工厂',
  floor:'楼层',
  selectFloor:'-- 选择楼层 --',
  startHint:'请选择工厂开始<br><span style="font-size:9px;color:#444c56">按 <b>F</b> 切换侧栏 &bull; <b>?</b> 快捷键</span>',
  selectFloorHint:'选择楼层查看地图',
  totalMachines:'设备总数',
  comingSoon:'(即将推出)',

  // ─── Machine status ───
  loader:'装载机',
  unloader:'卸载机',
  run:'运行',
  idle:'待机',
  down:'故障',

  // ─── Map / Legend ───
  selectMap:'选择工厂和楼层查看地图',
  legendIdle:'待机',
  legendDown:'故障 / 错误',
  overview:'全局视图',

  // ─── Tooltip / Popup ───
  type:'类型',
  zone:'区域',
  error:'错误',
  updated:'更新',
  mode:'模式',
  alarm:'警报',
  alarmCategory:'警报类别',
  productId:'产品编号',
  lotQty:'料号',
  totalSheet:'总片数',
  pctQr:'读码率',
  date:'日期',
  status:'状态',
  statusHistory:'状态历史',
  noHistory:'暂无状态历史',

  // ─── QR Code ───
  qrRead:'QR Code 读取率',
  qrCodeRead:'QR Code 读取',

  // ─── Connection ───
  connected:'已连接',
  disconnected:'已断开',
  demoMode:'演示',
  lastUpdate:'最后更新:',

  // ─── Search ───
  search:'搜索设备...',
  noResults:'未找到设备',

  // ─── Alerts ───
  alertNotif:'警报通知',
  noAlerts:'暂无警报',

  // ─── Keyboard shortcuts ───
  kbEsc:'关闭弹窗',
  kbZoom:'缩放',
  kbReset:'重置缩放',
  kbSidebar:'显示/隐藏侧栏',
  kbScreenshot:'截图',
  kbSearch:'搜索',
  kbThis:'快捷键',

  // ─── Daily Summary ───
  dailySummary:'📊 每日汇总（3天）',
  lots:'批次',
  panels:'面板',
  alarms:'警报',
  loading:'⏳ 加载中...',
  loadError:'❌ 加载失败',
  noData:'— 暂无数据 —',
  hasData:'台设备有数据',
  noMachineData:'暂无数据',
  others:'其他',
  pcs:'片',

  // ─── Info Panel sections ───
  machineInfo:'设备信息',
  qrHistory:'QR Code 历史',
  qrHistoryByLot:'QR 历史 (按批次)',
  pctQrHistory:'% QR 历史',
  lotStartTime:'批次开始时间',
  lotEndTime:'批次结束时间',

  // ─── Date range ───
  today:'今天',
  lastMonth:'最近1个月',
  latest100:'最新100',
  allData:'全部',
  perPage100:'每页100',
  exportCsv:'⬇ CSV',
  fullscreen:'⤢',
  loadMore:'⬇ 加载更多 (100)',
  loadMore:'⬇ 加载更多 (100)',

  // ─── Machine Info history picker ───
  viewHistoryDate:'查看历史数据',
  noMachineHistData:'该设备在选定日期无数据',
  histBadge:'查看日期',
  machineDateTitle:'选择要查看的历史日期',
  machineDateTodayTitle:'返回今日实时数据',

  // ─── NO_DATA ───
  noDataMachine:'— 设备无最新数据 —',
  noDataPanel:'— 无数据 —',
  noMachineSelected:'— 点击设备查看数据 —',
  noQrData:'— 此期间无 QR Code —',
  producing:'生产中...',
  startLabel:'开始',
  endLabel:'结束',

  // ─── Button titles (tooltips) ───
  zoomIn:'放大 (+)',
  zoomOut:'缩小 (-)',
  zoomReset:'重置缩放 (0)',
  screenshot:'截图 (P)',
  zoneEditor:'区域编辑器',
  zoneToggle:'显示/隐藏区域',
  zoneExport:'导出区域 (E)',
  machineDrag:'拖动设备 (M)',
  machineExport:'导出设备位置',
  refreshBtn:'刷新',
  closeBtn:'关闭',
  exportCsvTitle:'导出 CSV',
  fullscreenTitle:'全屏',

  // ─── Admin mode ───
  adminTitle:'管理员模式',
  adminPassword:'密码',
  adminLoginError:'密码不正确',
  adminLoginBtn:'登录',
  adminCancelBtn:'取消',
  adminToolbarTitle:'管理员',
  adminDrawZone:'绘制区域',
  adminMoveMachine:'移动设备',
  adminExportZones:'导出区域',
  adminExportMachines:'导出设备',
  adminToggleZones:'显示/隐藏区域',
  adminExit:'退出管理员',

  // ─── Hints ───
  zoneEditHint:'点击多个点绘制区域 · 按 Enter 完成 · 按 Esc 取消 · 点击红点删除',
  machineDragHint:'拖动设备到新位置 · 按 Esc 退出 · 按 ⬆M 导出',

  // ─── QR Fullscreen ───
  qrFullscreenTitle:'QR 历史',

  // ─── Zone Export Modal ───
  zoneExportTitle:'⬆ 导出区域预设 — 复制代码并粘贴到 index.html',
  zoneExportDesc:'将此代码替换 index.html 中的 <code style="color:var(--accent)">ZONE_PRESETS</code> → 所有人将看到相同的区域',
  zoneExportCopy:'📋 复制',
  machineExportTitle:'⬆M 导出设备位置 — 复制代码并粘贴到 index.html',
  // ─── Hardcoded texts (converted to i18n) ───
  sqsTitle:'📊 % QR 汇总',
  dsTitle:'📊 每日汇总（3天）',
  noDataDash:'— 暂无数据 —',
  noLatestData:'— 设备无最新数据 —',
  loadingDots:'⏳ 加载中...',
  loadFailed:'❌ 加载失败',
  loadFailedBackend:'❌ 加载失败 (后端错误)',
  noQrInPeriod:'— 此期间无 QR Code —',
  loadMore100:'⬇ 加载更多 (100)',
  grandTotal:'合计',
  machinesWithData:'台设备有数据',
  noDataYet:'暂无数据',
  producing:'生产中...',
  lotStartLabel:'批次开始时间',
  lotEndLabel:'批次结束时间',
  openPopupFirst:'请先打开设备弹窗',
  noQrHistory:'无 QR 历史数据',
  selectFactoryFirst:'请先选择工厂和楼层',
  noZonesYet:'暂无区域 — 请先绘制区域',
  copiedToClipboard:'已复制！粘贴到 index.html 替换 ZONE_PRESETS',
  pressCtrlC:'请按 Ctrl+C 复制',

  // ─── Zone names (โซน) ───
  zoneTempOffice:'临时办公室',
  zoneDrilling:'钻孔',
  zoneLamination:'压合',
  zonePressMachine:'压机区',
  zoneTraywashing:'Tray清洗',
  zonePlasma:'Plasma',
  zonePTCopperPlating:'电镀前处理',
  zoneCopperPlating:'电镀',
  zoneCopperPlatingII:'电镀二铜',
  zone16AxisGrinding:'十六轴磨刷',
  zonePlugHole:'塞孔',
  zoneDESInnerLayer:'内层DES',
  zoneInnerOuterLayer:'线路内外层',
  zoneAOI:'AOI',
  zoneVCP:'VCP',
  zoneDES:'DES',
  zoneRouting:'成型',
  zoneSurfaceTreatment:'表面处理',
  zoneSolderMask:'防焊',
  zoneETestFinalInspection:'电测终检',
  zoneElectroplating:'电镀',
  zoneLayer:'线路',
  zoneCopperPlating2:'电镀',
};
