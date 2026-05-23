## 가우시안 분포(Gaussian Distribution)를 활용한 다변량 이상탐지(Multivariate Anomaly Detection)는 데이터가 다차원 정규분포를 따른다고 가정하고, 중심에서 멀리 떨어진(확률이 매우 낮은) 데이터를 이상치로 판별하는 기법입니다. OHLCV(Open, High, Low, Close, Volume) 데이터에 이를 적용하는 파이썬 코드 예제입니다.

import numpy as np
import pandas as pd
from sklearn.covariance import EllipticEnvelope

# 1. 가상의 OHLCV 데이터 생성 (100일 기준)
np.random.seed(42)
dates = pd.date_range(start="2026-01-01", periods=100, freq='D')

# 정상 데이터 생성
close = np.linspace(100, 150, 100) + np.random.normal(0, 2, 100)
open_price = close - np.random.normal(0, 1, 100)
high = np.maximum(open_price, close) + np.random.uniform(0, 3, 100)
low = np.minimum(open_price, close) - np.random.uniform(0, 3, 100)
volume = np.random.normal(10000, 1500, 100)

df = pd.DataFrame({'Open': open_price, 'High': high, 'Low': low, 'Close': close, 'Volume': volume}, index=dates)

# 2. 인위적인 이상치 주입 (예: 50번째 날 거래량 폭발 및 가격 급락)
df.iloc[50] = [120, 125, 80, 85, 50000] 


# 3. 모델 입력 데이터 설정 (OHLCV 전체 활용)
features = ['Open', 'High', 'Low', 'Close', 'Volume']
X = df[features].values

# 4. 다변량 가우시안 이상탐지 모델 정의
# contamination: 전체 데이터 중 이상치 비율 설정 (예: 2%)
model = EllipticEnvelope(contamination=0.02, random_state=42)

# 5. 모델 학습 및 예측
# 1은 정상(Inlier), -1은 이상치(Outlier)를 의미함
df['Anomaly_Score'] = model.fit(X).decision_function(X) # 중심과의 거리 기반 점수 (낮을수록 이상치)
df['Is_Anomaly'] = model.predict(X)

# 6. 결과 확인
anomalies = df[df['Is_Anomaly'] == -1]
print(anomalies)
