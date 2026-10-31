# VaniClip Desktop

Ứng dụng dựng video chạy cục bộ trên Windows, xây bằng Electron, React, Vite và FFmpeg. VaniClip hỗ trợ dựng timeline nhiều lớp, công cụ AI tùy chọn và xuất video cho các tỉ lệ phổ biến.

**Website:** [vaniclip.com](https://vaniclip.com) · **Tải bản Windows:** [vaniclip.com/tai-ve](https://vaniclip.com/tai-ve/)

![Giao diện VaniClip Desktop](assets/vaniclip-desktop-screenshot.png)

## Chức năng

- Nhập video, ảnh, GIF và audio; sắp xếp, trim, split, crop và thay đổi tốc độ clip.
- Dựng timeline nhiều track (hình ở trên, tiếng ở dưới): kéo thả file vào đúng track và thời điểm, tách âm thanh khỏi video, menu chuột phải (sao chép, nhân bản, tách, khung hình dừng, tăng cường…), chọn nhiều và kéo nhóm, cắt mép bằng chuột, xóa dồn, mốc, bảng thuộc tính theo mục đang chọn, chia tab (vị trí, xoay, lật, mờ, tốc độ, âm lượng, cân bằng; kéo nhãn ô số để chỉnh nhanh), thêm chữ, sticker, phụ đề, nhạc nền và chuyển cảnh.
- Nhiều timeline trong một project (tab Timeline 1, Timeline 2…) để làm nhiều tập hoặc nhiều clip; thư viện media dùng chung, mỗi tab có lịch sử hoàn tác riêng.
- Phân tích khoảng lặng, tạo phụ đề, đọc văn bản và xử lý nền bằng các model AI tải riêng.
- Lưu/mở project, relink media, thu thập media để chuyển project, undo/redo và khôi phục phiên.
- Xuất MP4 bằng CPU hoặc encoder GPU khả dụng, chọn chất lượng (Cao/Chuẩn/Nhỏ gọn), độ phân giải cạnh ngắn (720/1080/1440) và xuất nhiều tỉ lệ. Tốc độ khung hình xuất cố định 30 fps; tỉ lệ Gốc giữ kích thước của clip đầu tiên.
- Tải media từ URL, dùng Google Cloud TTS và đổi khuôn mặt là các tính năng tùy chọn cần kết nối/cấu hình phù hợp.

## AI Auto Edit (tab "AI Tự dựng")

Nhập câu lệnh tiếng Việt → AI tự lấy toàn bộ video/ảnh trong thư viện Media, dò cảnh (FFmpeg), cắt khoảng lặng, nhận dạng lời thoại tiếng Việt (Whisper cục bộ, cắt cửa sổ theo RAM), lấy khung hình đại diện cho từng đoạn rồi gửi cho Claude hoặc OpenAI **xem ảnh + đọc lời thoại** để chọn/sắp xếp cảnh. Bạn xem trước (bỏ/đổi thứ tự cảnh) rồi bấm **Áp dụng vào timeline**: clip, phụ đề, tỷ lệ 16:9 / 9:16 / 1:1, nhạc nền (âm lượng tự cân theo giọng đo được) và ducking đều được đặt sẵn; sau đó xuất bằng hộp thoại Xuất hiện có.

- Không khóa 60 giây: để trống thời lượng = linh hoạt; hoặc đặt giới hạn tối đa. Video dài chia lô (số khung hình/lượt, model Whisper, cửa sổ âm thanh tự giảm khi ít RAM/CPU).
- Chưa đăng nhập AI → bộ lập kế hoạch cục bộ (giữ đoạn có lời thoại, không xem ảnh).
- Đăng nhập bằng **API key** (Claude, OpenAI), lưu mã hóa; trạng thái (đã xác thực / không hợp lệ / chạm giới hạn) được main theo dõi và đẩy về giao diện. VaniClip **không** đọc cookie/phiên của claude.ai hay chatgpt.com.
- Kiểm thử: `npm run test:unit` (gồm `test-auto-edit.mjs`), `npm run test:autoedit` (pipeline thật với FFmpeg, Whisper/AI giả lập).

## Yêu cầu

- Windows 10/11 x64: có thể đóng gói installer Windows bằng `npm run dist`.
- macOS: hỗ trợ đóng gói ứng dụng `.dmg` và `.zip` cho Intel (`x64`) và Apple Silicon (`arm64`) bằng các lệnh bên dưới. Nên build trực tiếp trên máy Mac.
- Node.js và npm cho môi trường phát triển.
- Internet khi cài dependencies hoặc tải model/tool lần đầu.

## Đóng gói cho macOS

Trên máy Mac, cài Node.js LTS trước, giải nén dự án, mở Terminal tại thư mục `vaniclip-desktop-main`, rồi chạy:

```bash
npm install
npm run dist:mac
```

Lệnh trên tạo gói `.dmg` và `.zip` cho cả Intel và Apple Silicon trong thư mục `release/`. Muốn chỉ build một kiến trúc:

```bash
npm run dist:mac:x64
npm run dist:mac:arm64
```

Lưu ý:
- Các gói hiện chưa được ký Developer ID hoặc notarize. macOS có thể cảnh báo ứng dụng từ nhà phát triển chưa xác định; chỉ mở nếu bạn tin tưởng mã nguồn.
- Để phát hành cho người dùng phổ thông, cần ký Developer ID và notarize bằng tài khoản Apple Developer.
- Bản macOS cần được build và kiểm thử trên Mac thực tế; cấu hình đóng gói không tự chứng minh toàn bộ tính năng hoạt động hoàn hảo trên macOS.

## Chạy bản phát triển

```bash
npm install
npm run dev
```

## Kiểm tra

```bash
npm run build
npm test
npm run test:ai
npm run test:dl
npm run test:face
```

`npm test` chạy kiểm tra schema/timeline, kiểm tra tĩnh renderer (lỗi dùng biến trước khi khai báo làm trắng màn hình lúc mở app, khóa i18n thiếu) và bộ test engine FFmpeg. Chưa có test giao diện tự động; cần thao tác thử trong Electron trước khi phát hành.

`npm run test:e2e` mở app Electron thật (bản build trong `dist/`, userData riêng) và điều khiển bằng chuột, thả file và xuất MP4 thật qua Chrome DevTools Protocol. Test này mở cửa sổ app nên không nằm trong `npm test`; thêm `--skip-build` nếu `dist/` vừa build, hoặc một từ khóa để chỉ chạy kịch bản khớp tên.

Một số kiểm tra AI/tải xuống cần Internet và có thể tải file lớn.

## Đóng gói Windows

```bash
npm run dist
```

Electron Builder tạo installer trong `release/`. Installer chưa ký số nếu môi trường build không có chứng thư ký.

## Dữ liệu và model bên thứ ba

Video, ảnh, audio và project được xử lý trên máy. Nếu bật Google Cloud TTS, đoạn văn bản bạn chọn sẽ được gửi tới Google để tổng hợp giọng nói. Model AI và công cụ được tải khi chạy có chủ sở hữu và điều khoản riêng; MIT license của mã nguồn VaniClip không cấp quyền phân phối lại các model đó. Hãy kiểm tra điều khoản của từng model trước khi sử dụng hoặc phân phối.

Các thư mục `models/` và `bin/yt-dlp.exe` chỉ là bộ nhớ đệm khi phát triển, không nằm trong git và không được đóng gói vào installer; ứng dụng tải chúng khi cần.

Chỉ tải media bạn có quyền sử dụng. Chỉ dùng tính năng đổi khuôn mặt khi có quyền và sự đồng ý phù hợp.

## Đóng góp và báo lỗi

Mở issue hoặc pull request trên GitHub. Khi báo lỗi, ghi phiên bản app, phiên bản Windows, thao tác tái hiện và trạng thái CPU/GPU. Không đính kèm API key, dữ liệu riêng tư hoặc media nhạy cảm.

## Ghi công

Bộ sticker trong `src/renderer/public/stickers/twemoji/` lấy từ [Twemoji](https://github.com/jdecked/twemoji) (Twitter, Inc. và cộng sự). Hình ảnh được phát hành theo [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), khác với code MIT của dự án. Nếu bạn phân phối lại các sticker này, giữ ghi công Twemoji.

## License

Mã nguồn VaniClip Desktop được phát hành theo MIT License. Xem [LICENSE](LICENSE).


## Cập nhật: Live phụ, nhiều bộ não, Tạo giọng đọc AI

- **Tab Kịch bản**: bỏ khung AI Tự dựng; có *Tài khoản Claude Live phụ* và *ChatGPT Live phụ* (5 tài khoản mỗi loại, phiên đăng nhập riêng, chấm xanh = đã đăng nhập). Khối giọng đọc có nút **Tạo giọng đọc** mở cửa sổ *Tạo giọng đọc AI*.
- **Tạo giọng đọc AI** (`src/renderer/VoiceStudio.jsx`, `electron/voice-studio.cjs`): Gemini TTS (nhiều khóa, 30 giọng), ElevenLabs API, Edge miễn phí (`msedge-tts`, tùy chọn) / giọng cục bộ tiếng Việt, cửa sổ web ElevenLabs/Gemini để tự tạo rồi nạp file. Văn bản không giới hạn: tạo từng dòng (cache theo nội dung), ghép 1 mp3 có khoảng lặng `( 1.2s | mô tả )`, thẻ cảm xúc, kênh lưu bộ giọng.
- **AI Tự dựng**: bỏ đăng nhập web; chọn **nhiều bộ não** (Claude/OpenAI API + các tài khoản Live đã đăng nhập) theo chế độ *Dự phòng* hoặc *Hội ý*; phụ đề tiếng Anh có thêm chế độ dịch từ giọng tiếng Việt.
- Sửa lỗi playhead đứng im sau khi Tách clip.
- Kiểm thử: `npm run test:unit` (có `test-voice-studio.cjs`), `npm run test:autoedit`.
- **Xem trước mượt, chuẩn khung hình**: khi nạp video khó phát (VFR, HEVC/AV1/ProRes, >1080p, 10-bit, bitrate cao, >60fps) app tự tạo proxy 720p CFR, GOP nửa giây, không B-frame ở nền và đổi nguồn xem trước khi bạn dừng phát; playhead và chuyển clip chạy theo từng khung hình (`requestVideoFrameCallback`). Xuất video vẫn dùng file gốc.
