# Lightweight Charts Setup Guide

## lightweight-charts 기반 Binance BTCUSDT.P 차트 안내

이제 TradingView Charting Library를 별도로 설치할 필요가 없습니다. 프로젝트는 open source `lightweight-charts`를 사용하여 Binance 선물 BTCUSDT.P 실시간 차트를 표시합니다.

### 1. 설치
`frontend` 폴더에서 다음 명령을 실행하세요:

```bash
npm install lightweight-charts
```

### 2. 구현
- 차트 컴포넌트: `src/components/TVChartContainer/index.tsx`
- 심볼: `BTCUSDT.P`
- 데이터: Binance Futures REST API + WebSocket
- 차트 라이브러리: `lightweight-charts`

### 3. 개발 서버 재시작
```bash
npm run dev
```

### 4. 확인
브라우저에서 홈페이지를 열고 "📈 트레이딩 차트" 탭에서 BTCUSDT.P 차트가 표시되는지 확인하세요.

## 참고
- `lightweight-charts` 문서: https://github.com/tradingview/lightweight-charts
- Binance Futures API: https://binance-docs.github.io/apidocs/futures/en/#kline-candlestick-data

## 문제 해결

- 차트가 뜨지 않으면 브라우저 콘솔에서 에러를 확인하세요.
- 네트워크 요청이 차단되는 경우 CORS 제한 또는 Binance API 접근 문제일 수 있습니다.
- `npm install` 후 개발 서버를 반드시 재시작하세요.
