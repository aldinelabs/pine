import type zhCN from "./zh-CN";

export default {
  scanCode: "페어링 코드 스캔",
  scanDescription:
    "Pine 설정 → 원격 제어의 코드에 카메라를 향하세요. 홈 화면에 추가했다면 이 앱에서 스캔하여 컴퓨터를 저장하세요.",
  cameraFailed:
    "카메라에 접근할 수 없습니다. 브라우저 또는 시스템 설정에서 카메라를 허용한 후 다시 시도하세요.",

  title: "Pine 원격",
  unsupported:
    "이 브라우저에서는 원격 제어를 사용할 수 없습니다. 최신 Safari 또는 Chrome을 사용하세요.",
  starting: "시작하는 중…",
  pairing: "컴퓨터에 연결하는 중…",
  confirmOnComputer: "컴퓨터에서 '허용'을 클릭하세요.",
  connecting: "{name}에 연결하는 중…",
  handshaking: "암호화된 연결을 설정하는 중…",
  computer: "컴퓨터",
  device: "기기",
  otherComputers: "다른 컴퓨터 선택",
  retry: "다시 시도",
  back: "뒤로",
  reconnect: "다시 연결",
  disconnected: "{name}과(와)의 연결이 끊어졌습니다.",
  forget: "제거",
  forgetTitle: "'{name}'을(를) 제거할까요?",
  forgetDescription:
    "이 기기는 다시 페어링하기 전까지 해당 컴퓨터에 연결할 수 없습니다.",
  cancel: "취소",
  emptyList:
    "페어링된 컴퓨터가 아직 없습니다. 컴퓨터에서 Pine 설정 → 원격 제어를 열고 '기기 페어링'을 클릭한 다음 코드를 스캔하거나 페어링 링크를 여세요.",
  lastConnected: "마지막 연결 {date}",
  expired: "이 코드가 만료되었습니다. 컴퓨터에서 새로 만드세요.",
  invalid: "Pine 페어링 링크가 아닙니다.",
  network:
    "시그널링 서비스에 연결할 수 없습니다. 네트워크를 확인하고 다시 시도하세요.",
  offline:
    "{name}이(가) 응답하지 않습니다. 해당 컴퓨터에서 Pine이 실행 중이고 'Aldine을 통한 원격 제어'가 켜져 있는지 확인하세요.",
  declined: "컴퓨터에서 페어링이 거부되었습니다.",
  unavailable:
    "컴퓨터가 지금은 기기를 받을 수 없습니다. Pine에서 브라우저 접속이 켜져 있는지 확인하세요.",
  failed: "컴퓨터에 연결할 수 없습니다. 나중에 다시 시도하세요.",
} satisfies typeof zhCN;
