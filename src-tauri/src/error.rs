#[derive(Debug)]
pub enum Error {
    Runtime(String),
    FileIO(String),
}
 
impl serde::Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
    	match self {
    		Error::Runtime(s) => serializer.serialize_str(s),
    		Error::FileIO(s) => serializer.serialize_str(s),
    	}
    }
}

#[macro_export]
macro_rules! err_runtime {
    ($fmt:expr $(, $args:expr)*) => {
        Err(Error::Runtime(format!($fmt $(, $args)*)))
    }
}

#[macro_export]
macro_rules! err_file_io {
    ($fmt:expr $(, $args:expr)*) => {
        Err(Error::FileIO(format!($fmt $(, $args)*)))
    }
}