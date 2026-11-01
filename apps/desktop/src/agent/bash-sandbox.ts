// Runtime installation trees only. In particular, /System includes the Data
// volume and must NOT be granted wholesale. Neither HOME nor arbitrary PATH
// entries are implicit read grants. Standard package-manager prefixes are
// explicitly included because their launchers and dynamic libraries live in
// separate directories (for example, MacPorts bash -> /opt/local/lib).
export const MACOS_RUNTIME_DIRECTORIES = [
  "/bin",
  "/sbin",
  "/usr/bin",
  "/usr/sbin",
  "/usr/lib",
  "/usr/libexec",
  "/usr/share",
  "/System/Library",
  "/System/Cryptexes/OS",
  "/System/Volumes/Preboot/Cryptexes/OS",
  "/private/preboot/Cryptexes/OS",
  "/Library/Apple",
  "/Library/Developer",
  "/Library/Frameworks",
  "/Library/Preferences",
  "/Applications",
  "/private/var/select",
  // Standard read-only runtime prefixes. These are installation trees, not
  // user data directories; allowing only their read side keeps the shell
  // usable without expanding its write boundary.
  "/opt/local",
  "/opt/homebrew",
  "/usr/local/Cellar",
  "/usr/local/opt",
  "/usr/local/bin",
  "/usr/local/sbin",
  "/usr/local/lib",
  "/usr/local/share",
  "/private/var/db/dyld",
  "/private/var/db/com.apple.dyld",
  "/private/var/db/timezone",
  "/private/etc/ssl/certs",
];

export const MACOS_RUNTIME_FILES = [
  // dyld opens the root directory during startup. This grants only the root
  // itself, not its descendants (unlike a subpath "/" rule).
  "/",
  "/dev/null",
  "/dev/zero",
  "/dev/tty",
  "/dev/random",
  "/dev/urandom",
  "/private/etc/zshenv",
  "/private/etc/passwd",
  "/private/etc/group",
  "/private/etc/hosts",
  "/private/etc/resolv.conf",
  "/private/etc/localtime",
  "/private/etc/ssl/cert.pem",
];

// Linux runtime trees. Merged-/usr distributions make /bin, /sbin and /lib*
// symlinks into /usr; the sandbox binds whichever form exists. /etc is not
// granted wholesale because it can hold readable host configuration, such as
// service credentials, that commands have no reason to see.
export const LINUX_RUNTIME_DIRECTORIES = [
  "/usr",
  "/bin",
  "/sbin",
  "/lib",
  "/lib32",
  "/lib64",
  "/libx32",
  "/etc/alternatives",
  "/etc/ca-certificates",
  "/etc/ld.so.conf.d",
  "/etc/pki",
  "/etc/ssl",
  // Homebrew on Linux, the counterpart of /opt/homebrew.
  "/home/linuxbrew/.linuxbrew",
];

export const LINUX_RUNTIME_FILES = [
  "/etc/passwd",
  "/etc/group",
  "/etc/nsswitch.conf",
  "/etc/hosts",
  "/etc/host.conf",
  "/etc/resolv.conf",
  "/etc/gai.conf",
  "/etc/localtime",
  "/etc/timezone",
  "/etc/ld.so.cache",
  "/etc/ld.so.conf",
  "/etc/os-release",
  "/etc/mime.types",
  "/etc/protocols",
  "/etc/services",
];
