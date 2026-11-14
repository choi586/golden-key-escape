# 🔑 황금 열쇠 대탈출

거대한 주인 아이의 방에 갇힌 꼬마 장난감이 되어, 무지개 나선 계단 꼭대기의 황금 열쇠를 들고 쥐구멍으로 탈출하는 멀티플레이 3D 브라우저 게임입니다. (Three.js + Node.js WebSocket)

## 조작법
- `W A S D` / 방향키: 이동 (계단은 걷기만 해도 올라갑니다)
- `Space`: 점프
- 마우스 드래그: 카메라 회전, 휠: 줌
- 모바일: 화면 왼쪽 드래그로 이동, 오른쪽 드래그로 시점, 점프 버튼

## 함께 플레이
같은 주소로 접속하면 같은 방(lobby)에서 만납니다. 방을 나누려면 주소 뒤에 `?room=원하는코드`를 붙이세요. 방당 최대 24명.

## 로컬 실행
```bash
npm install
npm start   # http://localhost:3000
```

## Render 배포
`render.yaml`이 포함되어 있어 Render에서 New → Blueprint로 이 저장소를 선택하면 됩니다. (Build: `npm install`, Start: `npm start`)
