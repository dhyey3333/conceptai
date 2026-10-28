import io
import wave

import numpy as np
import pytest
from fastapi.testclient import TestClient

from helper import tts, video
from helper.app import app

client = TestClient(app)


def test_wav_is_16_bit_mono_with_the_right_length():
    samples = np.sin(np.linspace(0, 100, 24000)).astype(np.float32)
    with wave.open(io.BytesIO(tts.to_wav(samples, 24000))) as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()) == (1, 2, 24000, 24000)


def test_each_voice_clip_lands_where_its_beat_started():
    rate = 1000
    clips = [(np.ones(100, np.float32), rate), None, (np.full(50, 0.5, np.float32), rate)]
    track, r = video.narration_track(clips, [10.5, 11.0, 12.0], t0=10.0, seconds=3)
    assert r == rate
    assert track[499] == 0 and track[500] == 1 and track[599] == 1 and track[600] == 0
    assert track[2000] == 0.5 and track[2049] == 0.5 and track[2050] == 0


def test_the_render_page_gets_the_lesson_but_not_the_speech_text():
    job = video.Job(id="0" * 16, lesson={"title": "T", "parts": [{"title": "P", "beats": [{"say": "Hi $x^2$", "speech": "Hi x squared", "draw": [], "point": None}]}]}, app_url="http://127.0.0.1:3100")
    job.durations = [[1200]]
    data = video.render_data(job)
    assert data["parts"][0]["beats"][0] == {"say": "Hi $x^2$", "draw": [], "point": None}
    assert data["durations"] == [[1200]]


def test_videos_are_only_recorded_from_this_computer():
    lesson = {"title": "T", "parts": [{"title": "P", "beats": [{"say": "Hi"}]}]}
    r = client.post("/video/start", json={"lesson": lesson, "appUrl": "http://example.com:3100"})
    assert r.status_code == 400
    assert client.get("/video/" + "f" * 16).status_code == 404


def _lesson(say: str = "Hi") -> dict:
    return {"title": "T", "language": "english", "parts": [{"title": "P", "beats": [{"say": say, "speech": say, "draw": [], "point": None}]}]}


@pytest.fixture
def no_making(monkeypatch, tmp_path):
    """Jobs are queued but never made, and the video library is a temporary folder."""
    monkeypatch.setattr(video, "_run", lambda job: None)
    monkeypatch.setattr(video, "VIDEOS", tmp_path)
    monkeypatch.setattr(video, "_jobs", {})
    return tmp_path


def test_a_lesson_already_made_is_ready_at_once(no_making):
    lesson = _lesson()
    (no_making / f"{video.content_key(lesson)}.mp4").write_bytes(b"mp4")
    job = video.start(lesson, "http://127.0.0.1:3100", auto=True)
    assert job.state == "done" and job.file.read_bytes() == b"mp4" and job.download_name() == "T.mp4"


def test_asking_again_while_it_is_made_joins_the_same_video(no_making):
    first = video.start(_lesson(), "http://127.0.0.1:3100", auto=True)
    again = video.start(_lesson(), "http://127.0.0.1:3100")
    assert again.id == first.id and not again.auto  # a person is waiting for it now
    assert video.start(_lesson("Changed"), "http://127.0.0.1:3100").id != first.id


def test_only_a_few_background_videos_queue_at_once(no_making):
    for i in range(video.MAX_AUTO_WAITING):
        video.start(_lesson(f"Lesson {i}"), "http://127.0.0.1:3100", auto=True)
    with pytest.raises(video.Busy):
        video.start(_lesson("One more"), "http://127.0.0.1:3100", auto=True)
    # A click is never refused.
    assert video.start(_lesson("One more"), "http://127.0.0.1:3100").state == "waiting"


@pytest.mark.skipif(not tts.installed(), reason="the offline voice isn't downloaded")
def test_the_offline_voice_speaks():
    r = client.post("/tts", json={"text": "Hello, this is your teacher.", "language": "english"})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/wav"
    assert int(r.headers["x-duration-ms"]) > 500
