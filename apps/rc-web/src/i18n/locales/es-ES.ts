import type zhCN from "./zh-CN";

export default {
  scanCode: "Escanear código de vinculación",
  scanDescription:
    "Apunta la cámara al código en Ajustes → Control remoto de Pine. Si añadiste Pine Remote a la pantalla de inicio, escanea aquí para guardar el ordenador en esta app.",
  cameraFailed:
    "No se puede acceder a la cámara. Permite el acceso en los ajustes del navegador o del sistema e inténtalo de nuevo.",

  pasteLink: "O pega un enlace de emparejamiento",
  pairWithLink: "Emparejar",

  title: "Pine Remoto",
  unsupported:
    "Este navegador no puede usar el control remoto. Usa una versión reciente de Safari o Chrome.",
  starting: "Iniciando…",
  pairing: "Conectando con tu ordenador…",
  confirmOnComputer: "Haz clic en Permitir en tu ordenador.",
  connecting: "Conectando con {name}…",
  handshaking: "Configurando una conexión cifrada…",
  computer: "Ordenador",
  device: "Dispositivo",
  otherComputers: "Elegir otro ordenador",
  retry: "Reintentar",
  back: "Atrás",
  reconnect: "Reconectar",
  disconnected: "Se perdió la conexión con {name}.",
  forget: "Quitar",
  forgetTitle: "¿Quitar «{name}»?",
  forgetDescription:
    "Este dispositivo ya no podrá conectarse hasta que lo vincules de nuevo.",
  cancel: "Cancelar",
  emptyList:
    "Aún no hay ordenadores vinculados. En tu ordenador, abre Ajustes de Pine → Control remoto, haz clic en Vincular un dispositivo y escanea el código o abre el enlace de vinculación.",
  lastConnected: "Última conexión {date}",
  expired: "Este código ha caducado. Crea uno nuevo en tu ordenador.",
  invalid: "Este no es un enlace de vinculación de Pine.",
  network:
    "No se puede acceder al servicio de señalización. Comprueba tu red e inténtalo de nuevo.",
  offline:
    "{name} no responde. Comprueba que Pine se está ejecutando en él y que el control remoto mediante Aldine está activado.",
  declined: "La vinculación se rechazó en el ordenador.",
  unavailable:
    "El ordenador no puede aceptar dispositivos ahora mismo. Comprueba que el acceso desde el navegador está activado en Pine.",
  failed: "No se pudo conectar con el ordenador. Inténtalo de nuevo más tarde.",
} satisfies typeof zhCN;
