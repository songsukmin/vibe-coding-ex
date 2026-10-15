#!/usr/bin/env python3
"""영상(또는 음성) 파일에서 말소리를 자막(SRT)과 단어별 타임스탬프(JSON)로 변환한다.

사용 예:
    .venv/bin/python scripts/transcribe.py input.mp4 --language ko
    .venv/bin/python scripts/transcribe.py input.mp4 --model small --max-chars 14
"""
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path


def extract_audio(video: Path, wav: Path) -> None:
    """ffmpeg로 영상에서 16kHz 모노 wav 소리만 뽑아낸다 (Whisper 권장 형식)."""
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(video),
           "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit(f"오디오 추출 실패:\n{result.stderr.strip()}")


def group_words(words, max_chars=16, max_gap=0.6, max_duration=3.0):
    """단어 목록을 릴스용 짧은 자막 덩어리로 묶는다.

    아래 중 하나라도 해당하면 새 자막을 시작한다.
    - 앞 단어와의 간격이 max_gap초 이상 (말이 끊김)
    - 글자 수가 max_chars를 넘음
    - 한 자막이 max_duration초를 넘음
    words: [{"word": str, "start": float, "end": float}, ...]
    """
    captions, cur = [], []

    def flush():
        if cur:
            text = "".join(w["word"] for w in cur).strip()
            if text:
                captions.append({"start": cur[0]["start"], "end": cur[-1]["end"], "text": text})
            cur.clear()

    for w in words:
        if cur:
            gap = w["start"] - cur[-1]["end"]
            text_len = len("".join(x["word"] for x in cur).strip()) + len(w["word"].strip())
            too_long = w["end"] - cur[0]["start"] > max_duration
            if gap >= max_gap or text_len > max_chars or too_long:
                flush()
        cur.append(w)
    flush()
    return captions


def fmt_time(t: float) -> str:
    ms = round(t * 1000)
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def to_srt(captions) -> str:
    blocks = []
    for i, c in enumerate(captions, 1):
        blocks.append(f"{i}\n{fmt_time(c['start'])} --> {fmt_time(c['end'])}\n{c['text']}\n")
    return "\n".join(blocks)


def transcribe(wav: Path, model_name, language, device, compute_type, use_vad):
    from faster_whisper import WhisperModel

    try:
        model = WhisperModel(model_name, device=device, compute_type=compute_type)
    except Exception as e:  # 모델 다운로드 실패 등
        sys.exit(f"모델 '{model_name}'을 불러오지 못했습니다: {e}\n"
                 "인터넷(Hugging Face) 접속이 필요하거나, --model 에 미리 받아둔 폴더 경로를 지정하세요.")
    segments, info = model.transcribe(
        str(wav), language=language, word_timestamps=True,
        vad_filter=use_vad, vad_parameters={"min_silence_duration_ms": 300},
    )
    words = []
    for seg in segments:  # 제너레이터라서 여기서 실제 변환이 진행된다
        for w in seg.words or []:
            words.append({"word": w.word, "start": w.start, "end": w.end})
    return words, info


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("input", type=Path, help="영상 또는 음성 파일")
    p.add_argument("--out-dir", type=Path, default=Path("output"), help="결과 저장 폴더 (기본: output)")
    p.add_argument("--model", default="small", help="모델 크기(tiny/base/small/medium/large-v3) 또는 로컬 폴더 경로")
    p.add_argument("--language", default=None, help="언어 코드 (예: ko, en). 생략하면 자동 감지")
    p.add_argument("--device", default="cpu", help="cpu 또는 cuda")
    p.add_argument("--compute-type", default="int8", help="cpu는 int8, GPU는 float16 권장")
    p.add_argument("--max-chars", type=int, default=16, help="자막 한 줄 최대 글자 수")
    p.add_argument("--no-vad", action="store_true", help="무음 구간 제거(VAD)를 끈다")
    args = p.parse_args()

    if not args.input.exists():
        sys.exit(f"파일을 찾을 수 없습니다: {args.input}")
    args.out_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "audio.wav"
        extract_audio(args.input, wav)
        words, info = transcribe(wav, args.model, args.language, args.device,
                                 args.compute_type, not args.no_vad)

    captions = group_words(words, max_chars=args.max_chars)
    stem = args.input.stem
    (args.out_dir / f"{stem}.srt").write_text(to_srt(captions), encoding="utf-8")
    (args.out_dir / f"{stem}.json").write_text(
        json.dumps({"language": info.language, "captions": captions, "words": words},
                   ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"완료: 언어={info.language}, 단어 {len(words)}개, 자막 {len(captions)}개 -> {args.out_dir}/{stem}.srt")


if __name__ == "__main__":
    main()
