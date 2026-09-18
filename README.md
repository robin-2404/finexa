# FINEXA 
**Explainable AI-Powered Fraud Investigation Platform**

FINEXA is a production-ready, locally hosted backend system designed to detect, explain, and investigate financial fraud. Moving beyond black-box classification, FINEXA provides investigators with deep, explainable insights into why a transaction is flagged, historical similarities, and emerging dataset-wide threat patterns.

Developed by S. YUVARAJHAN and team during the September 2026 30-hour hackathon at Vellore Institute of Technology.

## 🚀 Core Modules

### 1. 🏠 Fraud Intelligence Dashboard
Real-time aggregated metrics, fraud-to-normal distributions, amount binning, and recent critical-risk transactions calculated directly from the underlying dataset.

### 2. 🔍 AI Transaction Analyzer (Explainable AI)
Evaluates new transactions in milliseconds. Utilizes **SHAP (SHapley Additive exPlanations)** to break down the exact features (e.g., time, amount, PCA variables) pushing the model toward or away from a fraud prediction. 

### 3. 🕵️ Investigation Center
Deep-dive forensics on flagged transactions. Leverages a **K-Nearest Neighbors (KNN)** similarity engine to instantly find and present historical transactions with identical behavior patterns.

### 4. 🧠 Fraud Pattern Lab
Unsupervised learning discovery. Applies **K-Means Clustering and PCA** to the entire dataset to automatically group and highlight emerging, high-risk operational patterns without prior labeling.

## 🛠 Tech Stack

* **Core Framework:** Python 3.10+, FastAPI, Uvicorn
* **Data Validation:** Pydantic v2
* **Machine Learning:** Scikit-Learn (RandomForest, KNN, KMeans, PCA)
* **Explainability:** SHAP (TreeExplainer)
* **Data Processing:** Pandas, NumPy
* **Model Serialization:** Joblib

## 📁 System Architecture

The backend follows a strict layered architecture separating routing, business logic, and machine learning pipelines for maximum modularity.

```text
FINEXA-Backend/
├── data/
│   └── fraud_dataset.csv          # Source dataset
├── ml/
│   ├── preprocess.py              # Data scaling and cleaning
│   ├── train_model.py             # Automated training pipeline
│   ├── predictor.py               # RF Inference
│   ├── explainer.py               # SHAP implementations
│   ├── similarity.py              # KNN search logic
│   └── cluster_patterns.py        # Unsupervised clustering
├── routes/                        # FastAPI Endpoints
├── schemas/                       # Pydantic Input/Output Models
├── services/                      # Core Business Logic
├── utils/                         # In-memory caching and helpers
└── main.py                        # Uvicorn entry point
