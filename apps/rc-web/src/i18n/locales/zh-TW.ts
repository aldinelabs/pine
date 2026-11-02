import type zhCN from "./zh-CN";

export default {
  title: "Pine 遠端控制",
  unsupported: "這個瀏覽器不支援遠端控制。請使用最新版的 Safari 或 Chrome。",
  starting: "正在啟動…",
  pairing: "正在連線電腦…",
  confirmOnComputer: "請在電腦上點選「允許」。",
  connecting: "正在連線 {name}…",
  handshaking: "正在建立加密連線…",
  computer: "電腦",
  device: "裝置",
  otherComputers: "選擇其他電腦",
  retry: "重試",
  back: "返回",
  reconnect: "重新連線",
  disconnected: "與 {name} 的連線已斷開。",
  forget: "移除",
  forgetTitle: "移除“{name}”？",
  forgetDescription: "這臺裝置將不再能連線它，之後需要重新配對。",
  cancel: "取消",
  emptyList:
    "還沒有配對的電腦。在電腦上開啟 Pine 設定 → 遠端控制，點選「配對新裝置」，然後掃描QR Code或開啟配對連結。",
  lastConnected: "上次連線 {date}",
  expired: "QR Code已過期。請在電腦上重新產生。",
  invalid: "這不是有效的 Pine 配對連結。",
  network: "無法連線到訊號服務，請檢查網路後重試。",
  offline:
    "{name} 沒有回應。請確認電腦上的 Pine 正在執行，並已開啟「經 Aldine 遠端控制」。",
  declined: "電腦上拒絕了這次配對。",
  unavailable: "電腦暫時無法接受連線。請確認電腦上的 Pine 已開啟瀏覽器存取。",
  failed: "無法與電腦建立連線。請稍後重試。",
} satisfies typeof zhCN;
