// Glass under the left sidebar of a Pine window, like system sidebars.
//
// On macOS 27 AppKit draws it: an NSSplitViewController's sidebar item sits
// behind the page. On macOS 26 an NSGlassEffectView stands in. The page stays
// transparent over it and opaque everywhere else, and the window paints a
// solid colour behind the glass.
//
// It also lets the quick composer round its glass as it opens into a window:
// NSGlassEffectView's corner radius can change at any time, but
// electron-liquid-glass only sets it once. And it turns off the system's
// animation for windows that play their own as they appear.
//
// Node-API is declared by hand below: only a few functions of its stable ABI
// are used, so the addon builds with clang alone, and it loads in any Electron.

#import <AppKit/AppKit.h>
#import <objc/runtime.h>
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
extern napi_status napi_get_buffer_info(napi_env env, napi_value value,
                                        void **data, size_t *length);
extern napi_status napi_get_value_double(napi_env env, napi_value value,
                                         double *result);
extern napi_status napi_get_value_bool(napi_env env, napi_value value,
                                       bool *result);
extern napi_status napi_create_double(napi_env env, double value,
                                      napi_value *result);
extern napi_status napi_get_boolean(napi_env env, bool value,
                                    napi_value *result);
extern napi_status napi_create_function(napi_env env, const char *name,
                                        size_t length, napi_callback cb,
                                        void *data, napi_value *result);
extern napi_status napi_set_named_property(napi_env env, napi_value object,
                                           const char *name, napi_value value);

/// How far the macOS 26 glass reaches under the page, so its edge never shows
/// while the sidebar's width catches up with the page.
static const CGFloat kGlassOverhang = 64;

/// Never takes clicks or cursors: the page above handles all input.
@interface PineSidebarGlassContainer : NSView
@end

@implementation PineSidebarGlassContainer
- (NSView *)hitTest:(NSPoint)point {
  return nil;
}
@end

/// A split view whose divider can neither be seen nor grabbed. The overrides
/// replace AppKit's answers rather than adding to them.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wobjc-missing-super-calls"
@interface PineSidebarSplitViewController : NSSplitViewController
@end

@implementation PineSidebarSplitViewController
- (NSRect)splitView:(NSSplitView *)splitView
      effectiveRect:(NSRect)proposedEffectiveRect
       forDrawnRect:(NSRect)drawnRect
   ofDividerAtIndex:(NSInteger)dividerIndex {
  return NSZeroRect;
}

- (BOOL)splitView:(NSSplitView *)splitView
    shouldHideDividerAtIndex:(NSInteger)dividerIndex {
  return YES;
}
@end
#pragma clang diagnostic pop

@interface PineSidebarGlass : NSObject
@property(nonatomic, strong) PineSidebarGlassContainer *container;
@property(nonatomic, strong) PineSidebarSplitViewController *split;
@property(nonatomic, strong) NSSplitViewItem *sidebarItem;
@property(nonatomic, strong) NSView *glass;
@property(nonatomic) BOOL appKitSidebar;
@property(nonatomic, strong) NSColor *originalBackground;
@property(nonatomic) BOOL originalOpaque;
@end

@implementation PineSidebarGlass
@end

static char kSidebarGlassKey;

static NSInteger SystemMajorVersion(void) {
  return NSProcessInfo.processInfo.operatingSystemVersion.majorVersion;
}

static NSWindow *WindowFromHandle(napi_env env, napi_value value) {
  void *data = NULL;
  size_t length = 0;
  if (napi_get_buffer_info(env, value, &data, &length) != 0 ||
      length < sizeof(void *))
    return nil;
  NSView *view = (__bridge NSView *)(*(void **)data);
  return [view isKindOfClass:NSView.class] ? view.window : nil;
}

static void PutBehindPage(NSWindow *window, NSView *view) {
  NSView *content = window.contentView;
  view.frame = content.bounds;
  view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [content addSubview:view positioned:NSWindowBelow relativeTo:nil];
}

static PineSidebarGlass *CreateGlass(NSWindow *window, BOOL appKitSidebar) {
  PineSidebarGlass *state = [PineSidebarGlass new];
  state.appKitSidebar = appKitSidebar;
  state.originalBackground = window.backgroundColor;
  state.originalOpaque = window.opaque;
  state.container = [[PineSidebarGlassContainer alloc] initWithFrame:NSZeroRect];

  if (appKitSidebar) {
    PineSidebarSplitViewController *split =
        [PineSidebarSplitViewController new];
    NSViewController *sidebar = [NSViewController new];
    sidebar.view = [[NSView alloc] initWithFrame:NSZeroRect];
    NSViewController *page = [NSViewController new];
    page.view = [[NSView alloc] initWithFrame:NSZeroRect];
    NSSplitViewItem *sidebarItem =
        [NSSplitViewItem sidebarWithViewController:sidebar];
    sidebarItem.canCollapse = YES;
    sidebarItem.allowsFullHeightLayout = YES;
    [split addSplitViewItem:sidebarItem];
    [split addSplitViewItem:[NSSplitViewItem
                                splitViewItemWithViewController:page]];
    split.splitView.dividerStyle = NSSplitViewDividerStyleThin;
    split.view.frame = state.container.bounds;
    split.view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [state.container addSubview:split.view];
    state.split = split;
    state.sidebarItem = sidebarItem;
  } else {
    // Looked up at run time, so the addon also builds with older SDKs.
    Class glassClass = NSClassFromString(@"NSGlassEffectView");
    NSView *glass = [[glassClass alloc] initWithFrame:NSZeroRect];
    glass.autoresizingMask = NSViewHeightSizable | NSViewMaxXMargin;
    [state.container addSubview:glass];
    state.glass = glass;
  }

  PutBehindPage(window, state.container);
  objc_setAssociatedObject(window, &kSidebarGlassKey, state,
                           OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  return state;
}

static void SetWidth(PineSidebarGlass *state, CGFloat width) {
  NSRect bounds = state.container.bounds;
  if (!state.appKitSidebar) {
    state.glass.hidden = width < 1;
    state.glass.frame =
        NSMakeRect(0, 0, width + kGlassOverhang, NSHeight(bounds));
    return;
  }
  NSSplitViewItem *item = state.sidebarItem;
  if (width < 1) {
    item.collapsed = YES;
    return;
  }
  item.minimumThickness = width;
  item.maximumThickness = width;
  item.collapsed = NO;
  [state.split.splitView setPosition:width ofDividerAtIndex:0];
  [state.split.view layoutSubtreeIfNeeded];
}

static void Remove(NSWindow *window) {
  PineSidebarGlass *state =
      objc_getAssociatedObject(window, &kSidebarGlassKey);
  if (!state) return;
  [state.container removeFromSuperview];
  window.backgroundColor = state.originalBackground;
  window.opaque = state.originalOpaque;
  objc_setAssociatedObject(window, &kSidebarGlassKey, nil,
                           OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

static napi_value JsBoolean(napi_env env, bool value) {
  napi_value result = NULL;
  napi_get_boolean(env, value, &result);
  return result;
}

/// The material this Mac can show: 2 for AppKit's sidebar, 1 for glass, 0
/// for none.
static napi_value Support(napi_env env, napi_callback_info info) {
  NSInteger major = SystemMajorVersion();
  double support = major >= 27 ? 2
                   : major >= 26 && NSClassFromString(@"NSGlassEffectView")
                       ? 1
                       : 0;
  napi_value result = NULL;
  napi_create_double(env, support, &result);
  return result;
}

/// show(handle, width, backing, appKitSidebar): shows the glass, or updates
/// it. `width` is in points; `backing` is 0xRRGGBB painted behind the glass.
static napi_value Show(napi_env env, napi_callback_info info) {
  size_t argc = 4;
  napi_value argv[4] = {NULL};
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != 0 || argc < 4)
    return JsBoolean(env, false);
  double width = 0;
  double backing = 0;
  bool appKitSidebar = false;
  NSWindow *window = WindowFromHandle(env, argv[0]);
  if (!window || napi_get_value_double(env, argv[1], &width) != 0 ||
      napi_get_value_double(env, argv[2], &backing) != 0 ||
      napi_get_value_bool(env, argv[3], &appKitSidebar) != 0)
    return JsBoolean(env, false);
  if (appKitSidebar ? SystemMajorVersion() < 27
                    : !NSClassFromString(@"NSGlassEffectView"))
    return JsBoolean(env, false);

  PineSidebarGlass *state =
      objc_getAssociatedObject(window, &kSidebarGlassKey);
  if (state && state.appKitSidebar != appKitSidebar) {
    Remove(window);
    state = nil;
  }
  if (!state) state = CreateGlass(window, appKitSidebar);

  uint32_t rgb = (uint32_t)backing;
  window.opaque = NO;
  window.backgroundColor =
      [NSColor colorWithSRGBRed:((rgb >> 16) & 0xff) / 255.0
                          green:((rgb >> 8) & 0xff) / 255.0
                           blue:(rgb & 0xff) / 255.0
                          alpha:1];
  SetWidth(state, MAX(0, width));
  return JsBoolean(env, true);
}

static napi_value Hide(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1] = {NULL};
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) == 0 && argc >= 1) {
    NSWindow *window = WindowFromHandle(env, argv[0]);
    if (window) Remove(window);
  }
  return JsBoolean(env, true);
}

static NSView *FindGlass(NSView *view, Class glassClass) {
  if ([view isKindOfClass:glassClass]) return view;
  for (NSView *subview in view.subviews) {
    NSView *found = FindGlass(subview, glassClass);
    if (found) return found;
  }
  return nil;
}

/// setGlassCornerRadius(handle, radius): rounds the window's glass view.
static napi_value SetGlassCornerRadius(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2] = {NULL};
  double radius = 0;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != 0 || argc < 2 ||
      napi_get_value_double(env, argv[1], &radius) != 0)
    return JsBoolean(env, false);
  NSWindow *window = WindowFromHandle(env, argv[0]);
  Class glassClass = NSClassFromString(@"NSGlassEffectView");
  NSView *glass =
      window && glassClass ? FindGlass(window.contentView, glassClass) : nil;
  if (!glass) return JsBoolean(env, false);
  [(id)glass setCornerRadius:MAX(0, radius)];
  return JsBoolean(env, true);
}

/// windowCornerRadius(handle): how round the system draws this window's
/// corners, or -1 when it does not say.
static napi_value WindowCornerRadius(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1] = {NULL};
  double radius = -1;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) == 0 && argc >= 1) {
    NSWindow *window = WindowFromHandle(env, argv[0]);
    // Private, so read defensively.
    @try {
      id value = [window valueForKey:@"_cornerRadius"];
      if ([value isKindOfClass:NSNumber.class]) radius = [value doubleValue];
    } @catch (NSException *exception) {
    }
  }
  napi_value result = NULL;
  napi_create_double(env, radius, &result);
  return result;
}

/// setWindowAnimates(handle, animates): whether the system animates the
/// window as it opens and closes.
static napi_value SetWindowAnimates(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2] = {NULL};
  bool animates = true;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != 0 || argc < 2 ||
      napi_get_value_bool(env, argv[1], &animates) != 0)
    return JsBoolean(env, false);
  NSWindow *window = WindowFromHandle(env, argv[0]);
  if (!window) return JsBoolean(env, false);
  window.animationBehavior = animates ? NSWindowAnimationBehaviorDefault
                                      : NSWindowAnimationBehaviorNone;
  return JsBoolean(env, true);
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
  Export(env, exports, "support", Support);
  Export(env, exports, "show", Show);
  Export(env, exports, "hide", Hide);
  Export(env, exports, "setGlassCornerRadius", SetGlassCornerRadius);
  Export(env, exports, "windowCornerRadius", WindowCornerRadius);
  Export(env, exports, "setWindowAnimates", SetWindowAnimates);
  return exports;
}
