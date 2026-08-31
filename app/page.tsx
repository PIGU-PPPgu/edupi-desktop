import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { EduPiRegistrationGate } from "@/components/EduPiRegistrationGate";
import { readEduPiRegistration } from "@/lib/edupi-registration";

import { I18nProvider } from "@/hooks/useI18n";

export const dynamic = "force-dynamic";

export default function Home() {
  let initialRegistered: boolean | null = null;
  try {
    initialRegistered = readEduPiRegistration().registered;
  } catch {
    // The client gate shows a bounded retry state without exposing file details.
  }
  return (
    <Suspense>
      <I18nProvider initialLocale="zh-CN">
        <EduPiRegistrationGate initialRegistered={initialRegistered}>
          <AppShell />
        </EduPiRegistrationGate>
      </I18nProvider>
    </Suspense>
  );
}
