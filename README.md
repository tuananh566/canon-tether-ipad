# Canon Tether — Ứng dụng Tether Shooting cho iPad

Ứng dụng React Native / Expo kết nối iPad với máy ảnh Canon RP qua WiFi sử dụng Canon CCAPI (Camera Control API). Ảnh được tự động tải về iPad ngay sau khi chụp.

## ✨ Tính năng

- **Tự động tải ảnh**: Ảnh JPEG được tải về iPad ngay sau khi nhấn nút chụp trên máy ảnh
- **Xem trước lớn**: Hiển thị ảnh mới nhất ở kích thước lớn trên iPad
- **Thư viện ảnh**: Xem lại tất cả ảnh đã tải trong phiên làm việc
- **Lưu vào Photo Library**: Ảnh được tự động lưu vào thư viện ảnh của iPad
- **Tự động kết nối lại**: Nếu mất kết nối WiFi, ứng dụng sẽ tự động thử kết nối lại
- **Giao diện tối**: Thiết kế dark theme phù hợp cho công việc chụp ảnh

## 📋 Yêu cầu

- **Máy ảnh**: Canon RP (hoặc máy Canon khác hỗ trợ CCAPI)
- **Firmware**: Cần cập nhật firmware hỗ trợ CCAPI
- **iPad**: iPad chạy iPadOS 15 trở lên
- **Mạng**: iPad và máy ảnh cần kết nối cùng mạng WiFi

## 🔧 Cài đặt máy ảnh Canon RP

1. **Cập nhật firmware** Canon RP lên phiên bản hỗ trợ CCAPI
2. Vào **Menu → Cài đặt mạng (Network settings)**
3. Bật **WiFi**
4. Chọn **Smartphone connection** hoặc **CCAPI**
5. Chọn chế độ **Access Point** (máy ảnh tạo WiFi riêng) hoặc kết nối vào WiFi hiện có
6. Ghi nhớ **địa chỉ IP** và **cổng (port)** hiển thị trên màn hình máy ảnh

## 🚀 Cài đặt & Chạy ứng dụng

### 1. Cài đặt dependencies

```bash
cd canon-tether-ipad
npm install
```

### 2. Chạy trên Expo Go (để test)

```bash
npx expo start
```

> **Lưu ý**: Một số tính năng (như lưu vào Photo Library) có thể cần development build thay vì Expo Go.

### 3. Tạo Development Build

```bash
# Cài đặt EAS CLI
npm install -g eas-cli

# Đăng nhập
eas login

# Tạo build cho iOS
eas build --platform ios --profile development
```

### 4. Tạo Production Build (.ipa)

```bash
# Build preview (internal distribution)
eas build --platform ios --profile preview

# Build production (App Store)
eas build --platform ios --profile production
```

## 📁 Cấu trúc dự án

```
canon-tether-ipad/
├── app/                          # Expo Router screens
│   ├── _layout.tsx               # Root layout (dark theme)
│   ├── index.tsx                 # Màn hình kết nối
│   ├── tether.tsx                # Màn hình tether chính
│   └── gallery.tsx               # Thư viện ảnh
├── src/
│   ├── services/
│   │   ├── ccapi.ts              # Canon CCAPI service
│   │   ├── eventPoller.ts        # Event polling service
│   │   └── photoDownloader.ts    # Tải & lưu ảnh
│   ├── hooks/
│   │   ├── useCameraConnection.ts # Hook quản lý kết nối
│   │   └── useEventPoller.ts      # Hook event polling
│   ├── types/
│   │   └── ccapi.ts              # TypeScript types
│   └── constants/
│       └── theme.ts              # Dark theme constants
├── assets/
│   └── icon.png                  # Icon ứng dụng (cần thay thế)
├── app.json                      # Expo config
├── eas.json                      # EAS Build config
├── package.json
├── tsconfig.json
└── README.md
```

## 🔌 Canon CCAPI Endpoints

| Endpoint | Mô tả |
|----------|--------|
| `GET /ccapi/ver100/deviceinformation` | Thông tin máy ảnh |
| `GET /ccapi/ver100/event/polling` | Long-poll chờ sự kiện mới |
| `GET /ccapi/ver100/devicestatus/storage` | Danh sách bộ nhớ |
| `GET /ccapi/ver100/contents/{storage}/{dir}` | Duyệt thư mục |
| `GET /ccapi/ver100/contents/{storage}/{dir}/{file}` | Tải file |

## ⚙️ Cách hoạt động

1. **Kết nối**: Nhập IP máy ảnh → ứng dụng gọi `/deviceinformation` để xác nhận
2. **Long Polling**: Sau khi kết nối, ứng dụng gọi `/event/polling` liên tục
3. **Phát hiện ảnh mới**: Khi CCAPI trả về `addedcontents`, ứng dụng tải file JPEG
4. **Lưu ảnh**: File được tải xuống bằng `expo-file-system`, sau đó lưu vào Photo Library bằng `expo-media-library`
5. **Hiển thị**: Ảnh mới nhất hiển thị ở preview lớn, các ảnh cũ hơn hiện trong strip thumbnails

## 🐛 Xử lý lỗi

- **Mất kết nối WiFi**: Event poller tự động thử lại với exponential backoff (2s → 4s → 8s → ... → 30s max)
- **Heartbeat**: Mỗi 10 giây kiểm tra kết nối bằng ping
- **Tải ảnh thất bại**: Hiển thị thông báo lỗi, không làm gián đoạn polling
- **Permission bị từ chối**: Ảnh vẫn lưu trong sandbox của ứng dụng

## 📝 Lưu ý quan trọng

- Ứng dụng chỉ tự động tải file **JPEG**. File RAW (CR3/CR2) bị bỏ qua để tiết kiệm băng thông.
- Cần thay file `assets/icon.png` bằng icon thực (1024x1024px) trước khi build production.
- Cập nhật `eas.json` với Apple ID và Team ID thật trước khi submit lên App Store.
- Đảm bảo iPad và máy ảnh **cùng mạng WiFi** hoặc iPad kết nối trực tiếp WiFi của máy ảnh.

## 📄 License

MIT
