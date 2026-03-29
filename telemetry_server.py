import asyncio
import json
import threading
import websockets
from pymavlink import mavutil
import math

SERIAL_PORT = "/dev/tty.usbserial-0001"
BAUD = 57600

state = {}
state_lock = threading.Lock()
connected = threading.Event()
clients = set()


def mavlink_thread():
    print("Connecting to Pixhawk...")
    master = mavutil.mavlink_connection(SERIAL_PORT, baud=BAUD)
    master.wait_heartbeat()
    print(f"✅ Connected — system {master.target_system}, component {master.target_component}")

    # Request all streams at 10Hz
    master.mav.request_data_stream_send(
        master.target_system,
        master.target_component,
        mavutil.mavlink.MAV_DATA_STREAM_ALL,
        10, 1
    )
    print("📡 Requested data streams @ 10Hz")
    connected.set()

    while True:
        try:
            msg = master.recv_match(blocking=True, timeout=1.0)
            if not msg:
                continue

            t = msg.get_type()
            update = {}

            # ── HEARTBEAT ──────────────────────────────────────────────
            if t == "HEARTBEAT":
                armed = bool(msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED)
                update["armed"]       = armed
                update["flight_mode"] = mavutil.mode_string_v10(msg)

            # ── ATTITUDE ───────────────────────────────────────────────
            elif t == "ATTITUDE":
                update["roll"]       = round(msg.roll, 4)
                update["pitch"]      = round(msg.pitch, 4)
                update["yaw"]        = round(msg.yaw, 4)
                update["rollspeed"]  = round(msg.rollspeed, 4)
                update["pitchspeed"] = round(msg.pitchspeed, 4)
                update["yawspeed"]   = round(msg.yawspeed, 4)

            # ── GLOBAL POSITION (fused EKF) ────────────────────────────
            elif t == "GLOBAL_POSITION_INT":
                update["lat"]     = msg.lat / 1e7
                update["lon"]     = msg.lon / 1e7
                update["alt"]     = round(msg.relative_alt / 1000.0, 2)
                update["alt_msl"] = round(msg.alt / 1000.0, 2)
                update["vx"]      = round(msg.vx / 100.0, 2)
                update["vy"]      = round(msg.vy / 100.0, 2)
                update["vz"]      = round(msg.vz / 100.0, 2)

            # ── VFR HUD ────────────────────────────────────────────────
            elif t == "VFR_HUD":
                update["airspeed"]    = round(msg.airspeed, 2)
                update["groundspeed"] = round(msg.groundspeed, 2)
                update["alt_vfr"]     = round(msg.alt, 2)
                update["climb"]       = round(msg.climb, 2)
                update["throttle"]    = msg.throttle
                update["heading"]     = msg.heading

            # ── SYS STATUS ─────────────────────────────────────────────
            elif t == "SYS_STATUS":
                update["voltage"]         = round(msg.voltage_battery / 1000.0, 2)
                update["current"]         = round(msg.current_battery / 100.0, 2)
                update["battery"]         = msg.battery_remaining
                update["cpu"]             = round(msg.load / 10.0, 1)
                update["sensors_health"]  = msg.onboard_control_sensors_health

            # ── BATTERY STATUS (more detailed) ─────────────────────────
            elif t == "BATTERY_STATUS":
                if msg.voltages[0] != 65535:
                    update["cell_voltage"] = round(msg.voltages[0] / 1000.0, 3)

            # ── GPS RAW ────────────────────────────────────────────────
            elif t == "GPS_RAW_INT":
                fix_map = {0:"NO FIX",1:"NO FIX",2:"2D FIX",3:"3D FIX",
                           4:"DGPS",5:"RTK FLOAT",6:"RTK FIX"}
                update["sats"]     = msg.satellites_visible
                update["fix_type"] = fix_map.get(msg.fix_type, "UNKNOWN")
                update["hdop"]     = round(msg.eph / 100.0, 2) if msg.eph != 65535 else None
                update["vdop"]     = round(msg.epv / 100.0, 2) if msg.epv != 65535 else None

            # ── SERVO OUTPUT (motors) ──────────────────────────────────
            elif t == "SERVO_OUTPUT_RAW":
                update["m1"] = msg.servo1_raw
                update["m2"] = msg.servo2_raw
                update["m3"] = msg.servo3_raw
                update["m4"] = msg.servo4_raw
                # Normalize to 0-100% (idle ~1100, full ~1900)
                for i, raw in enumerate([msg.servo1_raw, msg.servo2_raw,
                                          msg.servo3_raw, msg.servo4_raw], 1):
                    update[f"m{i}_out"] = round(max(0, min(100, (raw - 1100) / 8.0)), 1)

            # ── RC CHANNELS ────────────────────────────────────────────
            elif t == "RC_CHANNELS":
                update["rssi"] = round(msg.rssi / 2.54, 1) if msg.rssi != 255 else 0
                update["rc_throttle"] = msg.chan3_raw

            # ── VIBRATION ──────────────────────────────────────────────
            elif t == "VIBRATION":
                update["vib_x"]    = round(msg.vibration_x, 4)
                update["vib_y"]    = round(msg.vibration_y, 4)
                update["vib_z"]    = round(msg.vibration_z, 4)
                update["clip_0"]   = msg.clipping_0
                update["clip_1"]   = msg.clipping_1
                update["clip_2"]   = msg.clipping_2

            # ── RAW IMU ────────────────────────────────────────────────
            elif t == "RAW_IMU":
                update["imu_xacc"] = msg.xacc
                update["imu_yacc"] = msg.yacc
                update["imu_zacc"] = msg.zacc
                update["imu_xgyro"] = msg.xgyro
                update["imu_ygyro"] = msg.ygyro
                update["imu_zgyro"] = msg.zgyro

            # ── EKF STATUS ─────────────────────────────────────────────
            elif t == "EKF_STATUS_REPORT":
                healthy = (msg.flags & 0x007) == 0x007
                update["ekf_healthy"]          = healthy
                update["ekf_flags"]            = msg.flags
                update["ekf_vel_variance"]     = round(msg.velocity_variance, 4)
                update["ekf_pos_horiz"]        = round(msg.pos_horiz_variance, 4)
                update["ekf_pos_vert"]         = round(msg.pos_vert_variance, 4)
                update["ekf_compass_variance"] = round(msg.compass_variance, 4)

            # ── OPTICAL FLOW ───────────────────────────────────────────
            elif t == "OPTICAL_FLOW":
                update["of_flow_x"]   = msg.flow_x
                update["of_flow_y"]   = msg.flow_y
                update["of_quality"]  = msg.quality

            # ── RANGEFINDER / DISTANCE SENSOR ─────────────────────────
            elif t in ("RANGEFINDER", "DISTANCE_SENSOR"):
                if t == "RANGEFINDER":
                    update["rangefinder"] = round(msg.distance, 2)
                else:
                    update["rangefinder"] = round(msg.current_distance / 100.0, 2)

            # ── NAV CONTROLLER ─────────────────────────────────────────
            elif t == "NAV_CONTROLLER_OUTPUT":
                update["wp_dist"]     = msg.wp_dist
                update["target_bearing"] = msg.target_bearing

            if update:
                with state_lock:
                    state.update(update)

        except Exception as e:
            print(f"MAVLink error: {e}")
            continue


async def broadcast_loop():
    while True:
        await asyncio.sleep(0.1)  # 10Hz broadcast

        if not clients:
            continue

        with state_lock:
            if not state:
                continue
            payload = json.dumps(state)

        dead = set()
        for client in set(clients):
            try:
                await client.send(payload)
            except Exception:
                dead.add(client)
        clients.difference_update(dead)


async def ws_handler(websocket):
    clients.add(websocket)
    print(f"Client connected ({len(clients)} total)")
    try:
        await websocket.wait_closed()
    finally:
        clients.discard(websocket)
        print(f"Client disconnected ({len(clients)} total)")


async def main():
    t = threading.Thread(target=mavlink_thread, daemon=True)
    t.start()

    print("Waiting for drone heartbeat...")
    while not connected.is_set():
        await asyncio.sleep(0.1)

    async with websockets.serve(ws_handler, "localhost", 8765):
        print("🌐 WebSocket running on ws://localhost:8765")
        await broadcast_loop()


if __name__ == "__main__":
    asyncio.run(main())