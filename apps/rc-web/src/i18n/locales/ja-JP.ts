import type zhCN from "./zh-CN";

export default {
  scanCode: "ペアリングコードをスキャン",
  scanDescription:
    "Pine の設定 → リモートコントロールのコードにカメラを向けてください。ホーム画面に追加した場合は、このアプリ内でスキャンしてコンピューターを保存してください。",
  cameraFailed:
    "カメラにアクセスできません。ブラウザーまたはシステムの設定でカメラを許可してから、再試行してください。",

  title: "Pine リモート",
  unsupported:
    "このブラウザではリモート操作を利用できません。最新の Safari または Chrome をお使いください。",
  starting: "起動しています…",
  pairing: "コンピュータに接続しています…",
  confirmOnComputer: "コンピュータで「許可」をクリックしてください。",
  connecting: "{name} に接続しています…",
  handshaking: "暗号化された接続を確立しています…",
  computer: "コンピュータ",
  device: "デバイス",
  otherComputers: "別のコンピュータを選択",
  retry: "もう一度試す",
  back: "戻る",
  reconnect: "再接続",
  disconnected: "{name} との接続が切断されました。",
  forget: "削除",
  forgetTitle: "「{name}」を削除しますか？",
  forgetDescription:
    "このデバイスは、再度ペアリングするまでこのコンピュータに接続できなくなります。",
  cancel: "キャンセル",
  emptyList:
    "ペアリング済みのコンピュータはまだありません。コンピュータで Pine の設定 → リモート操作を開き、「デバイスをペアリング」をクリックして、コードを読み取るかペアリングリンクを開いてください。",
  lastConnected: "最終接続 {date}",
  expired:
    "このコードの有効期限が切れました。コンピュータで新しいコードを作成してください。",
  invalid: "これは Pine のペアリングリンクではありません。",
  network:
    "シグナリングサービスに接続できません。ネットワークを確認して、もう一度お試しください。",
  offline:
    "{name} が応答しません。コンピュータで Pine が起動していて、「Aldine 経由のリモート操作」がオンになっているか確認してください。",
  declined: "コンピュータ側でペアリングが拒否されました。",
  unavailable:
    "コンピュータは現在デバイスを受け付けられません。Pine でブラウザアクセスがオンになっているか確認してください。",
  failed:
    "コンピュータに接続できませんでした。しばらくしてからもう一度お試しください。",
} satisfies typeof zhCN;
