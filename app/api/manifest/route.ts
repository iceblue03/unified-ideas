import { NextResponse } from "next/server";
import { getManifest } from "../../../lib/dataset";

export async function GET() {
  return NextResponse.json(getManifest());
}
