"""Pydantic request models for the Budget4 API."""
import datetime
from typing import Optional

from pydantic import BaseModel, Field


class TransactionCreate(BaseModel):
    date: datetime.date
    amount: float
    description: str
    account: str
    category: str = ""
    necessity_level: str = ""


class TransactionUpdateItem(BaseModel):
    id: int
    category: Optional[str] = None
    necessity_level: Optional[str] = None
    # Kept as strings so malformed dates can be reported as 400 (not Pydantic 422).
    timescale: Optional[str] = None
    timescale_end: Optional[str] = None
    ignore: Optional[bool] = None


class TransactionUpdateRequest(BaseModel):
    updates: list[TransactionUpdateItem] = Field(default_factory=list)


class CategoryCreate(BaseModel):
    name: str


class RenameRequest(BaseModel):
    new_name: str


class NecessityLevelCreate(BaseModel):
    name: str


class ImportConfigPut(BaseModel):
    date_column: str
    amount_column: str
    description_column: str
    expenditure_sign: str


class RuleCreate(BaseModel):
    regex: str
    category: str
    necessity_level: str


class ReviewKeys(BaseModel):
    keys: list[str] = Field(default_factory=list)
