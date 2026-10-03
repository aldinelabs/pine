import type { Pinia } from "pinia";
import {
  createRouter,
  createWebHashHistory,
  type RouteRecordRaw,
  type Router,
  type RouterHistory,
} from "vue-router";
import { ROUTE_NAMES } from "./routes";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: ROUTE_NAMES.workspace,
    component: () => import("@/views/ProjectView.vue"),
  },
  {
    path: "/:pathMatch(.*)*",
    redirect: { name: ROUTE_NAMES.workspace },
  },
];

/**
 * Pine has a single workspace view. The open tabs, not the route, decide
 * which project the window shows; the route only carries UI state such as
 * the active tab, so the Pinia instance is accepted for API stability.
 */
export function createAppRouter(
  _pinia: Pinia,
  history: RouterHistory = createWebHashHistory(),
): Router {
  return createRouter({ history, routes });
}
