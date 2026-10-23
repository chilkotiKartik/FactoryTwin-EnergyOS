import { redirect } from "next/navigation";
import { currentActor } from "@/server/auth/session-next";

export default async function Home() {
  redirect((await currentActor()) ? "/dashboard" : "/login");
}
