"""
Credit Card Fraud Detection API
Converted from the supplied creditcardfraud.py analysis notebook.

Run locally:
    uvicorn main:app --reload

The service:
- loads creditcard.csv
- scales Time and Amount
- creates a balanced training sample
- removes extreme outliers
- trains the seven models used in the original analysis
- exposes analysis and prediction endpoints
"""

from __future__ import annotations

import os
import boto3
from io import BytesIO
import warnings
from typing import Dict, List, Optional

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sklearn.discriminant_analysis import LinearDiscriminantAnalysis
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.manifold import TSNE
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import KFold, cross_val_score, train_test_split
from sklearn.neighbors import KNeighborsClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from sklearn.tree import DecisionTreeClassifier
from xgboost import XGBClassifier

warnings.filterwarnings("ignore")

APP_TITLE = "Credit Card Fraud Detection API"
DATA_PATH = os.getenv("DATA_PATH", "")
S3_BUCKET = os.getenv("S3_BUCKET", "credit-fraud-dataset-lalith")
S3_KEY = os.getenv("S3_KEY", "Datasets/creditcard.csv")
RANDOM_STATE = 42

FEATURES = [f"V{i}" for i in range(1, 29)] + ["scaled_amount", "scaled_time"]
RAW_FEATURES = [f"V{i}" for i in range(1, 29)] + ["Amount", "Time"]


class PredictionRequest(BaseModel):
    """Raw transaction fields required for a prediction."""

    Time: float = Field(..., description="Transaction time in seconds")
    Amount: float = Field(..., ge=0, description="Transaction amount")
    V1: float
    V2: float
    V3: float
    V4: float
    V5: float
    V6: float
    V7: float
    V8: float
    V9: float
    V10: float
    V11: float
    V12: float
    V13: float
    V14: float
    V15: float
    V16: float
    V17: float
    V18: float
    V19: float
    V20: float
    V21: float
    V22: float
    V23: float
    V24: float
    V25: float
    V26: float
    V27: float
    V28: float


class ModelRegistry:
    def __init__(self) -> None:
        self.df: Optional[pd.DataFrame] = None
        self.subsample: Optional[pd.DataFrame] = None
        self.cleaned: Optional[pd.DataFrame] = None
        self.scaler_amount = StandardScaler()
        self.scaler_time = StandardScaler()
        self.models: Dict[str, object] = {}
        self.model_scores: List[dict] = []
        self.best_model_name: Optional[str] = None
        self.tsne_points: List[dict] = []
        self.correlation: Dict[str, float] = {}
        self.ready = False

    def load_and_prepare(self) -> None:
        if DATA_PATH and os.path.isfile(DATA_PATH):
            df = pd.read_csv(DATA_PATH)
        else:
            s3 = boto3.client("s3")
            response = s3.get_object(
                Bucket=S3_BUCKET,
                Key=S3_KEY,
            )
            with response["Body"] as body:
                df = pd.read_csv(body)
        required = set(RAW_FEATURES + ["Class"])
        missing = required - set(df.columns)
        if missing:
            raise ValueError(f"Dataset is missing columns: {sorted(missing)}")

        # Same core transformation as the supplied script:
        # standardize Time and Amount and append the scaled versions.
        df["scaled_amount"] = self.scaler_amount.fit_transform(df[["Amount"]]).ravel()
        df["scaled_time"] = self.scaler_time.fit_transform(df[["Time"]]).ravel()
        self.df = df.copy()

        # Keep the original analysis idea: create a balanced sample from train data.
        train, _ = train_test_split(
            df,
            test_size=0.10,
            random_state=RANDOM_STATE,
            stratify=df["Class"],
        )

        fraud = train[train["Class"] == 1]
        non_fraud = train[train["Class"] == 0]
        selected_non_fraud = non_fraud.sample(
            n=len(fraud), random_state=RANDOM_STATE
        )

        subsample = pd.concat([selected_non_fraud, fraud], ignore_index=True)
        subsample = subsample.sample(frac=1, random_state=RANDOM_STATE).reset_index(drop=True)
        self.subsample = subsample

        # Same 2.5 * IQR extreme-outlier rule from the supplied code.
        numeric = subsample[FEATURES + ["Class"]]
        q1 = numeric.quantile(0.25)
        q3 = numeric.quantile(0.75)
        iqr = q3 - q1
        mask = ~(
            (numeric < (q1 - 2.5 * iqr))
            | (numeric > (q3 + 2.5 * iqr))
        ).any(axis=1)

        self.cleaned = subsample.loc[mask].reset_index(drop=True)

    def train_models(self) -> None:
        if self.cleaned is None:
            raise RuntimeError("Data has not been prepared.")

        X = self.cleaned[FEATURES]
        y = self.cleaned["Class"].astype(int)

        X_train, X_test, y_train, y_test = train_test_split(
            X,
            y,
            test_size=0.20,
            random_state=RANDOM_STATE,
            stratify=y,
        )

        model_defs = {
            "Logistic Regression": LogisticRegression(
                max_iter=2000, random_state=RANDOM_STATE
            ),
            "LDA": LinearDiscriminantAnalysis(),
            "KNN": KNeighborsClassifier(),
            "Decision Tree": DecisionTreeClassifier(
                random_state=RANDOM_STATE, max_depth=8
            ),
            "SVM": SVC(probability=True, random_state=RANDOM_STATE),
            "XGBoost": XGBClassifier(
                n_estimators=150,
                max_depth=4,
                learning_rate=0.08,
                subsample=0.9,
                colsample_bytree=0.9,
                eval_metric="logloss",
                random_state=RANDOM_STATE,
                n_jobs=2,
            ),
            "Random Forest": RandomForestClassifier(
                n_estimators=200,
                random_state=RANDOM_STATE,
                n_jobs=-1,
                class_weight="balanced",
            ),
        }

        kfold = KFold(
            n_splits=5, shuffle=True, random_state=RANDOM_STATE
        )

        scores = []
        for name, model in model_defs.items():
            cv = cross_val_score(
                model,
                X_train,
                y_train,
                cv=kfold,
                scoring="roc_auc",
            )
            model.fit(X_train, y_train)
            pred = model.predict(X_test)
            if hasattr(model, "predict_proba"):
                prob = model.predict_proba(X_test)[:, 1]
            else:
                prob = model.decision_function(X_test)

            scores.append(
                {
                    "model": name,
                    "roc_auc_mean": float(cv.mean()),
                    "roc_auc_std": float(cv.std()),
                    "test_roc_auc": float(roc_auc_score(y_test, prob)),
                    "accuracy": float(accuracy_score(y_test, pred)),
                    "precision": float(precision_score(y_test, pred, zero_division=0)),
                    "recall": float(recall_score(y_test, pred, zero_division=0)),
                }
            )
            self.models[name] = model

        self.model_scores = sorted(
            scores, key=lambda item: item["roc_auc_mean"], reverse=True
        )
        self.best_model_name = self.model_scores[0]["model"]

    def build_tsne(self) -> None:
        if self.cleaned is None:
            return

        # The notebook applies t-SNE to the cleaned balanced sample.
        # A cap keeps API startup predictable if the dataset changes.
        data = self.cleaned
        if len(data) > 1500:
            data = data.sample(1500, random_state=RANDOM_STATE)

        embedding = TSNE(
            n_components=2,
            random_state=RANDOM_STATE,
            init="pca",
            learning_rate="auto",
            perplexity=min(30, max(5, len(data) // 10)),
        ).fit_transform(data[FEATURES].values)

        self.tsne_points = [
            {
                "x": float(point[0]),
                "y": float(point[1]),
                "class": int(label),
            }
            for point, label in zip(embedding, data["Class"].values)
        ]

    def initialize(self) -> None:
        self.load_and_prepare()
        self.train_models()

        if self.cleaned is not None:
            corr = self.cleaned[FEATURES + ["Class"]].corr()["Class"].drop("Class")
            self.correlation = {
                key: float(value) for key, value in corr.sort_values().items()
            }

        self.build_tsne()
        self.ready = True

    def transform_prediction(self, request: PredictionRequest) -> pd.DataFrame:
        raw = request.model_dump()
        amount = float(raw.pop("Amount"))
        time = float(raw.pop("Time"))

        row = pd.DataFrame([raw])
        row["scaled_amount"] = self.scaler_amount.transform([[amount]]).ravel()[0]
        row["scaled_time"] = self.scaler_time.transform([[time]]).ravel()[0]
        return row[FEATURES]

    def predict(self, request: PredictionRequest, model_name: Optional[str] = None):
        if not self.ready:
            raise HTTPException(status_code=503, detail="Model is still initializing.")

        selected = model_name or self.best_model_name
        if selected not in self.models:
            raise HTTPException(
                status_code=404,
                detail=f"Unknown model '{selected}'. Available models: {list(self.models)}",
            )

        X = self.transform_prediction(request)
        model = self.models[selected]
        prediction = int(model.predict(X)[0])

        probability = None
        if hasattr(model, "predict_proba"):
            probability = float(model.predict_proba(X)[0, 1])

        return {
            "model": selected,
            "prediction": prediction,
            "label": "Fraudulent" if prediction == 1 else "Non-Fraudulent",
            "fraud_probability": probability,
        }


registry = ModelRegistry()

app = FastAPI(
    title=APP_TITLE,
    description=(
        "REST API for the credit-card fraud analysis and ML workflow "
        "derived from the supplied Python notebook."
    ),
    version="1.0.0",
)

# GitHub Pages is a different origin, so CORS is required.
# For production, replace '*' with the exact GitHub Pages origin.
allowed_origins = os.getenv("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup_event():
    registry.initialize()


@app.get("/")
def root():
    return {
        "name": APP_TITLE,
        "status": "ok" if registry.ready else "initializing",
        "docs": "/docs",
    }


@app.get("/api/health")
def health():
    return {
        "status": "ok" if registry.ready else "initializing",
        "dataset_rows": int(len(registry.df)) if registry.df is not None else 0,
        "best_model": registry.best_model_name,
    }


@app.get("/api/summary")
def summary():
    if registry.df is None or registry.cleaned is None:
        raise HTTPException(status_code=503, detail="Data is not ready.")

    counts = registry.df["Class"].value_counts().to_dict()
    total = len(registry.df)
    fraud = int(counts.get(1, 0))
    normal = int(counts.get(0, 0))

    return {
        "total_transactions": total,
        "normal_transactions": normal,
        "fraudulent_transactions": fraud,
        "normal_percentage": normal / total * 100,
        "fraud_percentage": fraud / total * 100,
        "balanced_sample_size": len(registry.subsample),
        "cleaned_sample_size": len(registry.cleaned),
        "removed_outliers": len(registry.subsample) - len(registry.cleaned),
        "amount_mean": float(registry.df["Amount"].mean()),
        "amount_max": float(registry.df["Amount"].max()),
        "time_min": float(registry.df["Time"].min()),
        "time_max": float(registry.df["Time"].max()),
    }


@app.get("/api/distributions")
def distributions(bins: int = Query(20, ge=5, le=100)):
    if registry.df is None:
        raise HTTPException(status_code=503, detail="Data is not ready.")

    def histogram(series: pd.Series):
        counts, edges = np.histogram(series, bins=bins)
        return [
            {
                "bin_start": float(edges[i]),
                "bin_end": float(edges[i + 1]),
                "count": int(counts[i]),
            }
            for i in range(len(counts))
        ]

    return {
        "time": histogram(registry.df["Time"]),
        "amount": histogram(registry.df["Amount"]),
    }


@app.get("/api/models")
def models():
    return {
        "best_model": registry.best_model_name,
        "models": registry.model_scores,
    }


@app.get("/api/correlation")
def correlation():
    return {
        "feature_correlation_with_class": registry.correlation
    }


@app.get("/api/tsne")
def tsne():
    return {
        "points": registry.tsne_points,
        "count": len(registry.tsne_points),
    }


@app.get("/api/transactions")
def transactions(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    fraud_only: bool = False,
):
    if registry.df is None:
        raise HTTPException(status_code=503, detail="Data is not ready.")

    data = registry.df
    if fraud_only:
        data = data[data["Class"] == 1]

    page = data.iloc[offset : offset + limit].copy()
    page = page[RAW_FEATURES + ["Class"]]

    return {
        "total": int(len(data)),
        "offset": offset,
        "limit": limit,
        "transactions": page.replace({np.nan: None}).to_dict(orient="records"),
    }


@app.post("/api/predict")
def predict(request: PredictionRequest, model: Optional[str] = None):
    return registry.predict(request, model_name=model)
