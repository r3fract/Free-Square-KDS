import type { Metadata } from "next";
import { KdsScreen } from "@/components/kds/kds-screen";

export const metadata: Metadata = {
  title: "KDS — Kitchen",
};

export default function KdsPage() {
  return <KdsScreen />;
}
