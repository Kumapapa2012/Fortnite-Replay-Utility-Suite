import subprocess
import sys
import os
import re


def parse_timestamp(ts):
    """Convert HH:mm:ss or seconds to float seconds."""
    if re.match(r'^\d+(\.\d+)?$', ts):
        return float(ts)
    parts = ts.split(':')
    if len(parts) == 3:
        h, m, s = parts
        return int(h) * 3600 + int(m) * 60 + float(s)
    elif len(parts) == 2:
        m, s = parts
        return int(m) * 60 + float(s)
    raise ValueError(f"Invalid timestamp format: {ts}")


def seconds_to_hms(seconds):
    """Convert seconds to HH:mm:ss.mmm format."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


def find_keyframes(video_path, start_seconds, duration=10):
    """Find keyframes between start and start+duration seconds."""
    end_seconds = start_seconds + duration

    cmd = [
        'ffprobe',
        '-v', 'quiet',
        '-select_streams', 'v:0',
        '-show_entries', 'frame=best_effort_timestamp_time,pict_type',
        '-of', 'csv=p=0',
        '-read_intervals', f'{start_seconds}%{end_seconds}',
        video_path
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)

    keyframes = []
    for line in result.stdout.strip().split('\n'):
        if not line:
            continue
        parts = line.strip().split(',')
        if len(parts) >= 2:
            ts, pict_type = parts[0], parts[1]
            if pict_type.strip() == 'I':
                try:
                    keyframes.append(float(ts))
                except ValueError:
                    pass

    return keyframes


def main():
    if len(sys.argv) != 3:
        print("Usage: python __prepare_upload.py <video_path> <timestamp>")
        print("  timestamp: HH:mm:ss or seconds (e.g. 00:01:30 or 90)")
        sys.exit(1)

    video_path = sys.argv[1]
    timestamp_str = sys.argv[2]

    if not os.path.isfile(video_path):
        print(f"Error: File not found: {video_path}")
        sys.exit(1)

    try:
        start_seconds = parse_timestamp(timestamp_str)
    except ValueError as e:
        print(f"Error: {e}")
        sys.exit(1)

    print(f"Searching for keyframes from {seconds_to_hms(start_seconds)} to {seconds_to_hms(start_seconds + 10)}...")

    keyframes = find_keyframes(video_path, start_seconds)

    if not keyframes:
        print("No keyframes found in the specified range.")
        sys.exit(1)

    print(f"\nFound {len(keyframes)} keyframe(s):")
    for i, kf in enumerate(keyframes):
        print(f"  [{i + 1}] {seconds_to_hms(kf)}  ({kf:.3f}s)")

    while True:
        try:
            choice = input(f"\nSelect a keyframe [1-{len(keyframes)}]: ").strip()
            idx = int(choice) - 1
            if 0 <= idx < len(keyframes):
                selected = keyframes[idx]
                break
            else:
                print(f"Please enter a number between 1 and {len(keyframes)}.")
        except ValueError:
            print("Please enter a valid number.")

    print(f"\nSelected keyframe: {seconds_to_hms(selected)}")

    output_path = os.path.join(os.path.dirname(os.path.abspath(video_path)), "upload.mp4")

    cmd = [
        'ffmpeg',
        '-ss', str(selected), 
        '-i', video_path,
        '-codec', 'copy',
        '-y',
        output_path
    ]

    print(f"Creating {output_path} ...")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode == 0:
        print(f"Done! Output saved to: {output_path}")
    else:
        print(f"Error creating video:\n{result.stderr}")
        sys.exit(1)


if __name__ == '__main__':
    main()
