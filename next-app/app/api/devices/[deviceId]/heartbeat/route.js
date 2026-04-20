import { NextResponse } from "next/server";
import { updateDeviceHeartbeat } from "../../../../../lib/devices";

function normalizeField(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request, { params }) {
  const deviceId = normalizeField(params?.deviceId);

  if (!deviceId) {
    return NextResponse.json({ message: "deviceId is required" }, { status: 400 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  const deviceSecret = normalizeField(body.deviceSecret);
  const status = normalizeField(body.status || "online").toLowerCase();

  if (!deviceSecret) {
    return NextResponse.json({ message: "deviceSecret is required" }, { status: 400 });
  }

  const heartbeat = await updateDeviceHeartbeat({
    deviceId,
    deviceSecret,
    status
  });

  if (!heartbeat) {
    return NextResponse.json({ message: "Device authentication failed" }, { status: 401 });
  }

  return NextResponse.json({
    message: heartbeat.secret_repaired ? "Heartbeat accepted and device secret updated" : "Heartbeat accepted",
    deviceId: heartbeat.device_id,
    lastSeenAt: heartbeat.last_seen_at,
    status: heartbeat.last_status,
    secretRepaired: heartbeat.secret_repaired
  });
}
