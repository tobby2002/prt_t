from pydantic_settings import BaseSettings, SettingsConfigDict

# BE가 충돌을 위해 FE수정된걸 해보는 테스트
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"


def get_settings() -> Settings:
    return Settings()
