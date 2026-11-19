// Per-component energy (CPU / GPU / ANE / DRAM) from IOReport's "Energy
// Model" group, without sudo and without changing any system setting.
// IOReport is a private framework (libIOReport); this is a measurement tool
// only and never ships in Pine.
//
//   cc -O2 -o iorep iorep.c -framework CoreFoundation -lIOReport
//   iorep <interval_ms>   -> one JSON line per interval, energy in millijoules
#include <CoreFoundation/CoreFoundation.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef struct IOReportSubscription *IOReportSubscriptionRef;
extern CFMutableDictionaryRef IOReportCopyChannelsInGroup(CFStringRef, CFStringRef, uint64_t, uint64_t, uint64_t);
extern IOReportSubscriptionRef IOReportCreateSubscription(void *, CFMutableDictionaryRef, CFMutableDictionaryRef *, uint64_t, CFTypeRef);
extern CFDictionaryRef IOReportCreateSamples(IOReportSubscriptionRef, CFMutableDictionaryRef, CFTypeRef);
extern CFDictionaryRef IOReportCreateSamplesDelta(CFDictionaryRef, CFDictionaryRef, CFTypeRef);
extern CFStringRef IOReportChannelGetChannelName(CFDictionaryRef);
extern CFStringRef IOReportChannelGetUnitLabel(CFDictionaryRef);
extern int64_t IOReportSimpleGetIntegerValue(CFDictionaryRef, int32_t);

static double to_mj(int64_t v, CFStringRef unit) {
  char u[16] = {0};
  if (unit) CFStringGetCString(unit, u, sizeof u, kCFStringEncodingUTF8);
  if (!strcmp(u, "nJ")) return v / 1e6;
  if (!strcmp(u, "uJ")) return v / 1e3;
  if (!strcmp(u, "mJ")) return (double)v;
  return v / 1e6;
}

int main(int argc, char **argv) {
  int interval = argc > 1 ? atoi(argv[1]) : 500;
  CFMutableDictionaryRef channels = IOReportCopyChannelsInGroup(CFSTR("Energy Model"), NULL, 0, 0, 0);
  if (!channels) { fprintf(stderr, "no Energy Model channels\n"); return 1; }
  CFMutableDictionaryRef subbed = NULL;
  IOReportSubscriptionRef sub = IOReportCreateSubscription(NULL, channels, &subbed, 0, NULL);
  if (!sub) { fprintf(stderr, "subscription failed\n"); return 1; }
  setvbuf(stdout, NULL, _IOLBF, 0);
  CFDictionaryRef prev = IOReportCreateSamples(sub, subbed, NULL);
  for (;;) {
    usleep(interval * 1000);
    CFDictionaryRef cur = IOReportCreateSamples(sub, subbed, NULL);
    CFDictionaryRef delta = IOReportCreateSamplesDelta(prev, cur, NULL);
    CFRelease(prev);
    prev = cur;
    CFArrayRef items = CFDictionaryGetValue(delta, CFSTR("IOReportChannels"));
    double cpu = 0, gpu = 0, ane = 0, dram = 0;
    for (CFIndex i = 0; items && i < CFArrayGetCount(items); i++) {
      CFDictionaryRef ch = CFArrayGetValueAtIndex(items, i);
      char name[128] = {0};
      CFStringRef n = IOReportChannelGetChannelName(ch);
      if (n) CFStringGetCString(n, name, sizeof name, kCFStringEncodingUTF8);
      double mj = to_mj(IOReportSimpleGetIntegerValue(ch, 0), IOReportChannelGetUnitLabel(ch));
      // Aggregate channels only; per-core channels would double count.
      if (strstr(name, "CPU Energy")) cpu += mj;
      else if (!strcmp(name, "GPU Energy") || !strcmp(name, "GPU")) gpu += mj;
      else if (!strncmp(name, "ANE", 3)) ane += mj;
      else if (!strncmp(name, "DRAM", 4)) dram += mj;
    }
    CFRelease(delta);
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    printf("{\"t\":%.3f,\"cpu_mj\":%.2f,\"gpu_mj\":%.2f,\"ane_mj\":%.2f,\"dram_mj\":%.2f}\n",
           ts.tv_sec + ts.tv_nsec / 1e9, cpu, gpu, ane, dram);
  }
}
