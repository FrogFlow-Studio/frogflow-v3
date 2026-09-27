import { getRouteApi } from "@tanstack/react-router";

/** Маршрут страницы настроек для её разделов (контекст магазина) без циклического импорта. */
export const settingsRoute = getRouteApi("/admin/_authed/settings");
