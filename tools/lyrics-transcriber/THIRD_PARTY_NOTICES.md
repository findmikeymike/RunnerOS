# Third-Party Notices: Lyrics Transcriber Runtime

This folder contains app-owned local runtime binaries for song transcription.

## whisper.cpp

- Component: `bin/darwin/arm64/whisper-cli`
- Version: `v1.9.1`
- Source: `https://github.com/ggml-org/whisper.cpp.git`
- Commit: `f049fff95a089aa9969deb009cdd4892b3e74916`
- License: MIT
- Build: CMake Release, static ggml/whisper libraries, no CoreML/OpenVINO/Metal dynamic runtime.
- Provenance: `bin/darwin/arm64/whisper-cli.provenance.json`

## FFmpeg

- Component: `bin/darwin/arm64/ffmpeg`
- Version: `8.1.2`
- Source: `https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz`
- License: LGPL-2.1-or-later build, configured without GPL, nonfree, network, or external libraries.
- Purpose: local audio conversion to 16 kHz mono PCM WAV before transcription.
- Provenance: `bin/darwin/arm64/ffmpeg.provenance.json`

Configuration used:

```text
--enable-static --disable-shared --disable-doc --disable-debug --disable-autodetect --disable-network --disable-everything --disable-programs --enable-ffmpeg --enable-protocol=file --enable-demuxer=wav,mp3,mov,flac,aiff,ogg,matroska --enable-muxer=wav --enable-decoder=pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,mp3,aac,alac,flac,vorbis,opus --enable-encoder=pcm_s16le --enable-parser=aac,mpegaudio,flac,vorbis,opus --enable-filter=aresample,aformat,anull --enable-avcodec --enable-avformat --enable-avfilter --enable-swresample --enable-avutil --enable-small
```

Release note: before shipping public installers, confirm third-party notice placement in the app bundle and legal acceptance of the FFmpeg LGPL compliance approach.
