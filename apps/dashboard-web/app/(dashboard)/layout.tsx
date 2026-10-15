"use client";

import type { ReactNode } from "react";
import { SessionGate } from "../../features/auth/components/session-gate.tsx";
import { OrdersPausedStrip } from "../../features/menu/components/orders-paused-strip.tsx";
import { LiveOrdersProvider } from "../../features/orders/hooks/live-orders.tsx";
import { DashboardHeader } from "../../shared/layout/dashboard-header.tsx";
import { SoundStrip } from "../../shared/sound/sound-strip.tsx";
import { LiveSettingsProvider } from "../../shared/settings/live-settings.tsx";

/**
 * Every page behind login (brief I §2.1, I-3): the guard, the header, and the
 * one poll of «الطلبات» feeding both the header's count and the list — and,
 * with each tick, the restaurant's settings (brief ي-ب §4), whose pause the
 * strip under the header shows on every page (§5) — and, under it, the
 * sound's strip while muted or stopped by the browser (brief م-ب).
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <SessionGate>
      {(session, logout) => (
        <LiveSettingsProvider>
          <LiveOrdersProvider>
            {(live) => (
              <>
                <DashboardHeader
                  restaurantName={session.restaurantName}
                  activeCount={live.orders ? live.orders.length : null}
                  offline={live.offline}
                  onLogout={logout}
                  strip={
                    <>
                      <OrdersPausedStrip />
                      <SoundStrip />
                    </>
                  }
                />
                {children}
              </>
            )}
          </LiveOrdersProvider>
        </LiveSettingsProvider>
      )}
    </SessionGate>
  );
}
