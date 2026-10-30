// What the floating composer knows about the app the user was in when they
// summoned it: which app and window, the document or page it shows, and the
// text selected in it.
//
// The frontmost app and its window come from NSWorkspace and the window
// list, which need no permission, so they are read before Pine takes focus.
// The window's title, document and selection come from Accessibility and
// are read afterwards: the app keeps its focused element while inactive.
//
// Node-API is declared by hand below, as in sidebar_glass.m.

#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct napi_env__ *napi_env;
typedef struct napi_value__ *napi_value;
typedef struct napi_callback_info__ *napi_callback_info;
typedef int napi_status;
typedef napi_value (*napi_callback)(napi_env env, napi_callback_info info);

extern napi_status napi_get_cb_info(napi_env env, napi_callback_info info,
                                    size_t *argc, napi_value *argv,
                                    napi_value *this_arg, void **data);
extern napi_status napi_get_value_int32(napi_env env, napi_value value,
                                        int32_t *result);
extern napi_status napi_create_int32(napi_env env, int32_t value,
                                     napi_value *result);
extern napi_status napi_create_string_utf8(napi_env env, const char *str,
                                           size_t length, napi_value *result);
extern napi_status napi_create_object(napi_env env, napi_value *result);
extern napi_status napi_get_null(napi_env env, napi_value *result);
extern napi_status napi_create_function(napi_env env, const char *name,
                                        size_t length, napi_callback cb,
                                        void *data, napi_value *result);
extern napi_status napi_set_named_property(napi_env env, napi_value object,
                                           const char *name, napi_value value);

/// Accessibility calls wait this long, in seconds, for an app that hangs.
static const float kMessagingTimeout = 0.25;
/// Longer selections are cut to this many characters.
static const NSUInteger kMaxSelectionLength = 100000;

static napi_value Null(napi_env env) {
  napi_value result = NULL;
  napi_get_null(env, &result);
  return result;
}

static void SetString(napi_env env, napi_value object, const char *name,
                      NSString *value) {
  if (value.length == 0) return;
  napi_value string = NULL;
  if (napi_create_string_utf8(env, value.UTF8String, (size_t)-1, &string) ==
      0)
    napi_set_named_property(env, object, name, string);
}

static void SetInt(napi_env env, napi_value object, const char *name,
                   int32_t value) {
  napi_value number = NULL;
  if (napi_create_int32(env, value, &number) == 0)
    napi_set_named_property(env, object, name, number);
}

static int32_t PidArgument(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1] = {NULL};
  int32_t pid = 0;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != 0 || argc < 1 ||
      napi_get_value_int32(env, argv[0], &pid) != 0)
    return 0;
  return pid;
}

/// The frontmost normal window of the app, front to back on screen.
static int32_t FrontWindowNumber(pid_t pid) {
  CFArrayRef windows = CGWindowListCopyWindowInfo(
      kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
      kCGNullWindowID);
  if (!windows) return 0;
  int32_t number = 0;
  for (NSDictionary *window in (__bridge NSArray *)windows) {
    if ([window[(__bridge NSString *)kCGWindowOwnerPID] intValue] != pid ||
        [window[(__bridge NSString *)kCGWindowLayer] intValue] != 0)
      continue;
    number = [window[(__bridge NSString *)kCGWindowNumber] intValue];
    break;
  }
  CFRelease(windows);
  return number;
}

/// `{ name, bundleId, pid, windowId }` of the frontmost app, or null when it
/// is Pine itself.
static napi_value FrontmostApp(napi_env env, napi_callback_info info) {
  NSRunningApplication *app = NSWorkspace.sharedWorkspace.frontmostApplication;
  if (!app || app.processIdentifier == getpid()) return Null(env);
  napi_value result = NULL;
  if (napi_create_object(env, &result) != 0) return Null(env);
  SetString(env, result, "name", app.localizedName);
  SetString(env, result, "bundleId", app.bundleIdentifier);
  SetInt(env, result, "pid", app.processIdentifier);
  int32_t window = FrontWindowNumber(app.processIdentifier);
  if (window) SetInt(env, result, "windowId", window);
  return result;
}

static CFTypeRef CopyAttribute(AXUIElementRef element, CFStringRef name) {
  CFTypeRef value = NULL;
  if (AXUIElementCopyAttributeValue(element, name, &value) != kAXErrorSuccess)
    return NULL;
  return value;
}

static NSString *StringAttribute(AXUIElementRef element, CFStringRef name) {
  CFTypeRef value = CopyAttribute(element, name);
  if (!value) return nil;
  NSString *string = nil;
  if (CFGetTypeID(value) == CFStringGetTypeID())
    string = [(__bridge NSString *)value copy];
  else if (CFGetTypeID(value) == CFURLGetTypeID())
    string = [(__bridge NSURL *)value absoluteString];
  CFRelease(value);
  return string;
}

static AXUIElementRef CopyElement(AXUIElementRef element, CFStringRef name) {
  CFTypeRef value = CopyAttribute(element, name);
  if (value && CFGetTypeID(value) != AXUIElementGetTypeID()) {
    CFRelease(value);
    return NULL;
  }
  return (AXUIElementRef)value;
}

/// `{ windowTitle, document, selectedText }` read through Accessibility from
/// the app with this pid; each is missing when the app does not say, and the
/// whole is null without the permission.
static napi_value Focus(napi_env env, napi_callback_info info) {
  pid_t pid = PidArgument(env, info);
  if (pid <= 0 || !AXIsProcessTrusted()) return Null(env);
  AXUIElementRef app = AXUIElementCreateApplication(pid);
  if (!app) return Null(env);
  AXUIElementSetMessagingTimeout(app, kMessagingTimeout);
  // Chromium and Electron apps build their accessibility tree only once
  // something asks for it.
  AXUIElementSetAttributeValue(app, CFSTR("AXManualAccessibility"),
                               kCFBooleanTrue);

  napi_value result = NULL;
  if (napi_create_object(env, &result) != 0) {
    CFRelease(app);
    return Null(env);
  }
  AXUIElementRef window = CopyElement(app, kAXFocusedWindowAttribute);
  if (window) {
    SetString(env, result, "windowTitle",
              StringAttribute(window, kAXTitleAttribute));
    // A file URL for documents; browsers give the page's address.
    SetString(env, result, "document",
              StringAttribute(window, kAXDocumentAttribute));
    CFRelease(window);
  }
  AXUIElementRef focused = CopyElement(app, kAXFocusedUIElementAttribute);
  if (focused) {
    NSString *selection = StringAttribute(focused, kAXSelectedTextAttribute);
    if (selection.length > kMaxSelectionLength)
      selection = [selection substringToIndex:kMaxSelectionLength];
    if ([selection stringByTrimmingCharactersInSet:
                       NSCharacterSet.whitespaceAndNewlineCharacterSet]
            .length > 0)
      SetString(env, result, "selectedText", selection);
    CFRelease(focused);
  }
  CFRelease(app);
  return result;
}

static void Export(napi_env env, napi_value exports, const char *name,
                   napi_callback callback) {
  napi_value function = NULL;
  if (napi_create_function(env, name, (size_t)-1, callback, NULL,
                           &function) == 0)
    napi_set_named_property(env, exports, name, function);
}

__attribute__((visibility("default"))) int32_t
node_api_module_get_api_version_v1(void) {
  return 8;
}

__attribute__((visibility("default"))) napi_value
napi_register_module_v1(napi_env env, napi_value exports) {
  Export(env, exports, "frontmostApp", FrontmostApp);
  Export(env, exports, "focus", Focus);
  return exports;
}
